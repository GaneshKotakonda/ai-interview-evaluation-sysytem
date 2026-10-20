"""Run candidate code against test cases (the VPL execution engine).

Programs read the test input from standard input and print the answer, as
in Moodle VPL and competitive programming. Supported: Python, JavaScript
(Node.js), C++17 and Java; a language is offered only when its compiler or
runtime is installed (``available_languages``).

Isolation:
  * Local testing: code runs here, in a fresh temporary folder, with a time
    limit per test, an output cap and an environment stripped of every
    secret (no DATABASE_URL, no API keys). On Linux the program also gets
    its own process group (killed as a whole) and an output-file size limit.
  * Deployment: set CODE_RUNNER_URL and the API sends the code to the
    separate runner container (runner_service.py), which has no internet
    access, a read-only filesystem and memory/CPU/process limits.

Output is compared token by token (whitespace-insensitive).

Candidates are isolated from each other, not only from the host. After
every test the program's whole process group is killed, and any process it
left behind (a forked or re-sessioned "daemon" that could read or tamper
with the next candidate's run) is swept:
  * everywhere: processes carrying this runner's private RUN_MARK in their
    environment;
  * in the dedicated runner container (RUNNER_ISOLATE=1, set by
    deploy/Dockerfile.runner): every leftover process of the runner's user,
    which also catches one that cleared its environment. There /tmp is
    emptied after each run and only one program runs at a time, so no other
    candidate's code exists while a program runs.
The container-wide sweep is never used on a developer machine, where it
could kill the developer's own processes.

Function-style problems (coding_functions.py) pass a ``marker``: the hidden
driver prints it before the returned value, so only the text after it is
compared, and what the candidate printed before it is returned as
``printed``.
"""
import logging
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Optional

import config

logger = logging.getLogger(__name__)

IS_WINDOWS = os.name == "nt"
MAX_CODE_BYTES = 64 * 1024
# The candidate's code plus a hidden test driver (coding_functions.py).
MAX_PROGRAM_BYTES = MAX_CODE_BYTES + 16 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
COMPILE_TIMEOUT_SECONDS = 30
# After this many time-outs the remaining tests are skipped (saves minutes).
MAX_TIMEOUTS = 2

LANGUAGES = {
    "python": {"label": "Python 3", "file": "main.py", "needs": None, "time_factor": 1.0},
    "javascript": {"label": "JavaScript (Node.js)", "file": "main.js", "needs": "node", "time_factor": 1.0},
    "cpp": {"label": "C++17", "file": "main.cpp", "needs": "g++", "time_factor": 1.0},
    "java": {"label": "Java", "file": "Main.java", "needs": "javac", "time_factor": 1.5},
}

# Isolated mode (the runner container): one program at a time, so a program
# never runs alongside another candidate's code.
ISOLATE = config.RUNNER_ISOLATE
_slots = threading.BoundedSemaphore(1 if ISOLATE else 2)   # programs run at the same time
# Set in every candidate process's environment, so leftovers can be found.
RUN_MARK = secrets.token_hex(12)
_active_sessions: set[int] = set()   # session ids of programs running now
_active_lock = threading.Lock()


class RunnerError(Exception):
    """The code could not be run (runner unavailable, bad request)."""


def available_languages() -> list[dict]:
    """Languages this server can run, for the editor's language menu."""
    if config.CODE_RUNNER_URL:
        try:
            return _remote("GET", "/languages")
        except RunnerError:
            return []
    return [{"id": key, "label": spec["label"]} for key, spec in LANGUAGES.items()
            if spec["needs"] is None or shutil.which(spec["needs"])]


def _commands(language: str, folder: str) -> tuple[Optional[list], list]:
    if language == "python":
        return None, [sys.executable, "-I", "-B", "main.py"]
    if language == "javascript":
        return None, [shutil.which("node") or "node", "--max-old-space-size=256", "main.js"]
    if language == "cpp":
        binary = os.path.join(folder, "main.exe" if IS_WINDOWS else "main")
        # No source excerpts in errors: a hidden prelude (coding_functions.py) shifts
        # the file's lines, but the reported line numbers stay right.
        return ([shutil.which("g++") or "g++", "-O2", "-std=c++17", "-fno-diagnostics-show-caret",
                 "-o", binary, "main.cpp"], [binary])
    if language == "java":
        return ([shutil.which("javac") or "javac", "-encoding", "UTF-8", "Main.java"],
                [shutil.which("java") or "java", "-Xmx256m", "-Xss64m", "-XX:+UseSerialGC", "Main"])
    raise RunnerError(f"Unsupported language '{language}'.")


def _environment(folder: str) -> dict:
    """Minimal environment: no secrets from the API's own environment."""
    env = {"PATH": os.environ.get("PATH", ""), "HOME": folder, "TMPDIR": folder, "TEMP": folder, "TMP": folder,
           "LANG": "C.UTF-8", "PYTHONIOENCODING": "utf-8", "VPL_RUN": RUN_MARK}
    for key in ("SYSTEMROOT", "WINDIR", "COMSPEC", "JAVA_HOME"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def _limits():
    """POSIX only: resource limits applied in the child before exec."""
    if IS_WINDOWS:
        return None

    def apply():
        import resource
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES * 4, MAX_OUTPUT_BYTES * 4))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.setsid()
    return apply


def _execute(command: list, folder: str, stdin: str, timeout: float) -> dict:
    """Run one process; stdout/stderr go to files so huge output cannot fill memory."""
    out_path, err_path = os.path.join(folder, ".stdout"), os.path.join(folder, ".stderr")
    started = time.perf_counter()
    with open(out_path, "wb") as out, open(err_path, "wb") as err:
        process = subprocess.Popen(command, cwd=folder, env=_environment(folder), stdin=subprocess.PIPE,
                                   stdout=out, stderr=err, preexec_fn=_limits(),
                                   creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0)
        # The child calls setsid(), so its session id is its pid.
        with _active_lock:
            _active_sessions.add(process.pid)
        timed_out = False
        try:
            process.communicate(stdin.encode("utf-8"), timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill(process)
            process.wait()
        except BrokenPipeError:
            process.wait()
        finally:
            # Always, not only on timeout: nothing the program started may
            # outlive its test.
            _kill(process)
            with _active_lock:
                _active_sessions.discard(process.pid)
            sweep_leftovers()
    elapsed = round((time.perf_counter() - started) * 1000)
    with open(out_path, "rb") as handle:
        stdout = handle.read(MAX_OUTPUT_BYTES + 1)
    with open(err_path, "rb") as handle:
        stderr = handle.read(4000)
    return {"timed_out": timed_out, "exit_code": process.returncode, "time_ms": elapsed,
            "stdout": stdout[:MAX_OUTPUT_BYTES].decode("utf-8", "replace"),
            "output_truncated": len(stdout) > MAX_OUTPUT_BYTES,
            "stderr": stderr.decode("utf-8", "replace")}


def _kill(process):
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True, timeout=5)
        else:
            os.killpg(process.pid, 9)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass  # already gone


def is_leftover(*, uid: int, sid: int, marked: bool, my_uid: int, my_sid: int, active: set, isolate: bool) -> bool:
    """Whether a process is something a finished program left behind."""
    if uid != my_uid or sid == my_sid or sid in active:
        return False   # someone else's, the service itself, or a program still running
    return isolate or marked


def _has_mark(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/environ", "rb") as handle:
            return f"VPL_RUN={RUN_MARK}".encode() in handle.read().split(b"\0")
    except OSError:
        return False


def sweep_leftovers() -> int:
    """Kill processes left behind by finished programs (Linux). Returns the count."""
    if IS_WINDOWS or not os.path.isdir("/proc"):
        return 0
    me, my_uid, my_sid = os.getpid(), os.getuid(), os.getsid(0)
    with _active_lock:
        active = set(_active_sessions)
    killed = 0
    for name in os.listdir("/proc"):
        if not name.isdigit() or int(name) == me:
            continue
        pid = int(name)
        try:
            uid = os.stat(f"/proc/{pid}").st_uid
            if uid != my_uid:
                continue
            sid = os.getsid(pid)
            if is_leftover(uid=uid, sid=sid, marked=ISOLATE or _has_mark(pid), my_uid=my_uid,
                           my_sid=my_sid, active=active, isolate=ISOLATE):
                os.kill(pid, 9)
                killed += 1
        except (OSError, ValueError):
            continue   # gone already, or not ours to touch
    return killed


def clean_tmp(base: str | None = None) -> None:
    """Isolated mode: empty the shared temp folder after a run, so nothing a
    program wrote there (a stash of copied files) survives into the next run."""
    base = base or tempfile.gettempdir()
    my_uid = os.getuid()
    for entry in os.scandir(base):
        try:
            if entry.stat(follow_symlinks=False).st_uid != my_uid:
                continue
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path, ignore_errors=True)
            else:
                os.unlink(entry.path)
        except OSError:
            continue


def outputs_match(actual: str, expected: str) -> bool:
    """Token comparison: extra spaces and line breaks do not matter."""
    return actual.split() == expected.split()


def _split_marker(stdout: str, marker: Optional[str]) -> tuple[Optional[str], str]:
    """(returned value, printed text); returned is None without the marker."""
    if not marker:
        return stdout, ""
    index = stdout.rfind(marker)
    if index < 0:
        return None, stdout
    return stdout[index + len(marker):], stdout[:index].rstrip("\n")


def _run_local(language: str, code: str, tests: list[dict], time_limit: float, marker: Optional[str] = None) -> dict:
    with _slots:
        try:
            with tempfile.TemporaryDirectory(prefix="vpl-") as folder:
                return _run_in(folder, language, code, tests, time_limit, marker)
        finally:
            if ISOLATE:
                # Still holding the slot: the next run starts clean.
                sweep_leftovers()
                clean_tmp()


def _run_in(folder: str, language: str, code: str, tests: list[dict], time_limit: float, marker: Optional[str]) -> dict:
    spec = LANGUAGES[language]
    limit = time_limit * spec["time_factor"]
    with open(os.path.join(folder, spec["file"]), "w", encoding="utf-8") as handle:
        handle.write(code)
    compile_command, run_command = _commands(language, folder)
    if compile_command:
        result = _execute(compile_command, folder, "", COMPILE_TIMEOUT_SECONDS)
        if result["timed_out"] or result["exit_code"] != 0:
            message = (result["stderr"] or result["stdout"] or "Compilation timed out.")[-3000:]
            return {"compiled": False, "compile_output": message.replace(folder, ""), "results": [],
                    "passed": 0, "total": len(tests)}
    results, timeouts = [], 0
    for test in tests:
        if timeouts >= MAX_TIMEOUTS:
            results.append({"status": "skipped", "time_ms": 0, "stdout": "", "stderr": ""})
            continue
        run = _execute(run_command, folder, test.get("input", ""), limit)
        returned, printed = _split_marker(run["stdout"], marker)
        if run["timed_out"]:
            status = "time_limit"
            timeouts += 1
        elif run["exit_code"] != 0:
            status = "runtime_error"
        elif run["output_truncated"]:
            status = "output_limit"
        elif returned is None:
            status = "runtime_error"  # stopped before returning a value
        elif "expected" in test and test["expected"] is not None:
            status = "passed" if outputs_match(returned, test["expected"]) else "wrong_answer"
        else:
            status = "ran"
        result = {"status": status, "time_ms": run["time_ms"], "stdout": (returned or "")[:4000],
                  "stderr": run["stderr"].replace(folder, "")[-1500:]}
        if marker:
            result["printed"] = printed[-2000:]
        results.append(result)
    passed = sum(1 for r in results if r["status"] == "passed")
    return {"compiled": True, "compile_output": "", "results": results, "passed": passed, "total": len(tests)}


def _remote(method: str, path: str, payload: Optional[dict] = None):
    import requests
    try:
        response = requests.request(method, config.CODE_RUNNER_URL.rstrip("/") + path, json=payload, timeout=180,
                                    headers={"X-Runner-Token": config.RUNNER_TOKEN})
        response.raise_for_status()
        return response.json()
    except Exception as err:
        logger.warning("Code runner unavailable: %s", err)
        raise RunnerError("The code runner is unavailable. Please try again.") from err


def run_tests(language: str, code: str, tests: list[dict], time_limit: Optional[float] = None,
              marker: Optional[str] = None) -> dict:
    """Run ``code`` on every test ``{input, expected?}``.

    Returns ``{compiled, compile_output, results: [{status, time_ms, stdout,
    stderr}], passed, total}``. status: passed | wrong_answer | time_limit |
    runtime_error | output_limit | skipped | ran (no expected output).
    With ``marker``, ``stdout`` is the text after it and ``printed`` the text
    before it; a run that never printed the marker is a runtime error.
    """
    if language not in LANGUAGES:
        raise RunnerError(f"Unsupported language '{language}'.")
    if len(code.encode("utf-8")) > (MAX_PROGRAM_BYTES if marker else MAX_CODE_BYTES):
        raise RunnerError("The code is too long.")
    limit = time_limit or config.CODE_TIME_LIMIT_SECONDS
    if config.CODE_RUNNER_URL:
        return _remote("POST", "/run", {"language": language, "code": code, "tests": tests, "time_limit": limit,
                                        "marker": marker})
    if language not in {item["id"] for item in available_languages()}:
        raise RunnerError(f"{LANGUAGES[language]['label']} is not installed on this server.")
    return _run_local(language, code, tests, limit, marker)
