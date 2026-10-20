# Candidates must not outlive their run: a forked, re-sessioned background
# process could otherwise read or tamper with the next candidate's code.
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import code_runner

LINUX = sys.platform.startswith("linux")

DAEMON = """
import os, sys, time
r, w = os.pipe()
if os.fork() == 0:
    os.setsid()                      # leave the run's process group and session
    pid = os.fork()
    if pid == 0:
        time.sleep(30)               # the would-be spy
        os._exit(0)
    os.write(w, str(pid).encode())
    os._exit(0)
os.close(w)
print(os.read(r, 32).decode())
"""


def alive(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/stat") as handle:
            return handle.read().split(")")[-1].split()[0] != "Z"
    except OSError:   # gone (possibly between open and read)
        return False


@unittest.skipUnless(LINUX, "process sweeping uses /proc")
class LeftoverProcessTests(unittest.TestCase):
    def test_a_forked_background_process_does_not_survive_the_run(self):
        run = code_runner.run_tests("python", DAEMON, [{"input": ""}])
        self.assertEqual(run["results"][0]["status"], "ran", run["results"][0]["stderr"])
        pid = int(run["results"][0]["stdout"].strip())
        for _ in range(20):
            if not alive(pid):
                break
            time.sleep(0.05)
        self.assertFalse(alive(pid), "the background process outlived its run")

    def test_the_sweep_leaves_unrelated_processes_alone(self):
        other = subprocess.Popen(["sleep", "30"], start_new_session=True)
        try:
            code_runner.sweep_leftovers()
            self.assertIsNone(other.poll())
        finally:
            other.kill()
            other.wait()

    def test_programs_still_run_normally(self):
        run = code_runner.run_tests("python", "print(int(input()) * 2)\n", [{"input": "21\n", "expected": "42"}])
        self.assertEqual(run["passed"], 1)


class LeftoverRuleTests(unittest.TestCase):
    base = dict(my_uid=1000, my_sid=1, active={50})

    def test_rule(self):
        rule = code_runner.is_leftover
        # Not ours, the service itself, or a program still running: never.
        self.assertFalse(rule(uid=0, sid=99, marked=True, isolate=True, **self.base))
        self.assertFalse(rule(uid=1000, sid=1, marked=True, isolate=True, **self.base))
        self.assertFalse(rule(uid=1000, sid=50, marked=True, isolate=True, **self.base))
        # A finished program's process: killed when marked, or always in the
        # runner container (catches one that cleared its environment).
        self.assertTrue(rule(uid=1000, sid=99, marked=True, isolate=False, **self.base))
        self.assertFalse(rule(uid=1000, sid=99, marked=False, isolate=False, **self.base))
        self.assertTrue(rule(uid=1000, sid=99, marked=False, isolate=True, **self.base))


class CleanTmpTests(unittest.TestCase):
    def test_empties_the_folder(self):
        base = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(base, ".stash", "deep"))
            with open(os.path.join(base, ".stash", "deep", "copied_main.py"), "w") as handle:
                handle.write("secret")
            with open(os.path.join(base, "note"), "w") as handle:
                handle.write("x")
            code_runner.clean_tmp(base)
            self.assertEqual(os.listdir(base), [])
        finally:
            shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
