"""Function-style coding problems: the candidate returns the answer.

The candidate writes a method of a ``Solution`` class that takes typed
parameters and returns the result; there is no reading of input or printing
of output. Behind the scenes a hidden driver, added after the candidate's
code, reads the test input, calls the method and prints the returned value.
So the code runner still runs an ordinary program on standard input, and the
tests, expected outputs and grading are unchanged.

The driver prints MARK on its own line before the returned value, so
anything the candidate prints while debugging is shown separately and never
counts as the answer (code_runner splits the output at the marker).

Types: int, long, bool, string, int[], string[], int[][].

Test input ("wire") format, one value after another:
  int / long / bool   one line: 42, -7, true
  string              a line with its length in UTF-8 bytes, then the text
                      and a newline (so spaces and empty strings are exact)
  int[]               a line with the count, then one line of the values
  string[]            a line with the count, then each string as above
  int[][]             a line with the row count, then each row as an int[]
The returned value is printed as tokens: lists space-separated, the rows of
an int[][] one per line, booleans as true/false. The existing expected
outputs already use this form.
"""
import json
import re
from dataclasses import dataclass
from typing import Optional

import code_runner

MARK = "@@VPL-RETURN@@"
TYPES = ("int", "long", "bool", "string", "int[]", "string[]", "int[][]")
SCALARS = ("int", "long", "bool", "string")
METHOD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
INT_RANGE = (-2 ** 31, 2 ** 31 - 1)
LONG_RANGE = (-2 ** 63, 2 ** 63 - 1)


@dataclass(frozen=True)
class Signature:
    method: str
    params: tuple                  # ((name, type), ...)
    returns: str

    def as_dict(self) -> dict:
        return {"method": self.method, "params": [{"name": n, "type": t} for n, t in self.params],
                "returns": self.returns}

    @staticmethod
    def from_dict(data: dict) -> "Signature":
        method = str(data.get("method", ""))
        params = tuple((str(p.get("name", "")), str(p.get("type", ""))) for p in data.get("params") or [])
        returns = str(data.get("returns", ""))
        names = [n for n, _ in params]
        if (not METHOD_NAME.match(method) or not params or len(params) > 6 or returns not in TYPES
                or any(t not in TYPES or not METHOD_NAME.match(n) for n, t in params) or len(set(names)) != len(names)):
            raise ValueError("Invalid function signature")
        return Signature(method, params, returns)


# -------------------------------------------------------------
# Values: checking, encoding, printing and displaying
# -------------------------------------------------------------
def check(kind: str, value) -> bool:
    """Whether ``value`` (a Python value) fits the type."""
    def integer(v, bounds):
        return isinstance(v, int) and not isinstance(v, bool) and bounds[0] <= v <= bounds[1]
    if kind == "int":
        return integer(value, INT_RANGE)
    if kind == "long":
        return integer(value, LONG_RANGE)
    if kind == "bool":
        return isinstance(value, bool)
    if kind == "string":
        return isinstance(value, str)
    if kind == "int[]":
        return isinstance(value, list) and all(integer(v, INT_RANGE) for v in value)
    if kind == "string[]":
        return isinstance(value, list) and all(isinstance(v, str) for v in value)
    if kind == "int[][]":
        return isinstance(value, list) and all(check("int[]", row) for row in value)
    return False


def _encode(kind: str, value, out: list) -> None:
    if kind in ("int", "long"):
        out.append(f"{value}\n")
    elif kind == "bool":
        out.append("true\n" if value else "false\n")
    elif kind == "string":
        out.append(f"{len(value.encode('utf-8'))}\n{value}\n")
    elif kind == "int[]":
        out.append(f"{len(value)}\n{' '.join(map(str, value))}\n")
    elif kind == "string[]":
        out.append(f"{len(value)}\n")
        for item in value:
            _encode("string", item, out)
    elif kind == "int[][]":
        out.append(f"{len(value)}\n")
        for row in value:
            _encode("int[]", row, out)


def encode(signature: Signature, args: list) -> str:
    """The test input for one call (see the module docstring)."""
    if len(args) != len(signature.params):
        raise ValueError("Wrong number of arguments")
    out = []
    for (name, kind), value in zip(signature.params, args):
        if not check(kind, value):
            raise ValueError(f"{name}: not a valid {kind}")
        _encode(kind, value, out)
    return "".join(out)


def format_value(kind: str, value) -> str:
    """A value printed exactly as the drivers print a returned value."""
    if kind == "bool":
        return "true" if value else "false"
    if kind == "int[]":
        return " ".join(map(str, value))
    if kind == "int[][]":
        return "\n".join(" ".join(map(str, row)) for row in value)
    if kind == "string[]":
        return "\n".join(value)
    return str(value)


def literal(kind: str, value) -> str:
    """A value as the candidate sees and types it: [2,7,11,15], "abc", true."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def display(kind: str, text: Optional[str]) -> Optional[str]:
    """Printed tokens (a returned or expected value) shown as a literal."""
    if text is None:
        return None
    if kind == "int[]":
        return "[" + ",".join(text.split()) + "]"
    if kind == "int[][]":
        rows = [line.split() for line in text.strip("\n").split("\n")] if text.strip() else []
        return "[" + ",".join("[" + ",".join(row) + "]" for row in rows) + "]"
    if kind == "string[]":
        return json.dumps(text.strip("\n").split("\n") if text.strip("\n") else [], ensure_ascii=False)
    if kind == "string":
        return json.dumps(text.rstrip("\n"), ensure_ascii=False)
    return text.strip()


_EXAMPLE = {"int": "5", "long": "5", "bool": "true", "string": '"abc"', "int[]": "[1,2,3]",
            "string[]": '["ab","cd"]', "int[][]": "[[1,2],[3,4]]"}


def parse_literal(name: str, kind: str, text: Optional[str]):
    """The candidate's own argument (custom input), checked against its type."""
    text = (text or "").strip()
    try:
        value = json.loads(text)
    except ValueError:
        if kind == "string":
            return text  # plain text without quotes is fine for a string
        value = None
    if kind == "long" and isinstance(value, float) and value.is_integer():
        value = int(value)
    if not check(kind, value):
        raise ValueError(f"{name} must be a {kind}, for example {_EXAMPLE[kind]}.")
    return value


# -------------------------------------------------------------
# Starter code
# -------------------------------------------------------------
_PY = {"int": "int", "long": "int", "bool": "bool", "string": "str", "int[]": "list[int]",
       "string[]": "list[str]", "int[][]": "list[list[int]]"}
_JS = {"int": "number", "long": "number", "bool": "boolean", "string": "string", "int[]": "number[]",
       "string[]": "string[]", "int[][]": "number[][]"}
_CPP = {"int": "int", "long": "long long", "bool": "bool", "string": "string", "int[]": "vector<int>",
        "string[]": "vector<string>", "int[][]": "vector<vector<int>>"}
_JAVA = {"int": "int", "long": "long", "bool": "boolean", "string": "String", "int[]": "int[]",
         "string[]": "String[]", "int[][]": "int[][]"}
TODO = "Write your code here and return the answer."


def _cpp_param(name: str, kind: str) -> str:
    return f"{_CPP[kind]}{'' if kind in SCALARS else '&'} {name}"


def starter(signature: Signature) -> dict:
    s = signature
    py_params = ", ".join(f"{n}: {_PY[t]}" for n, t in s.params)
    js_doc = "\n".join(f"   * @param {{{_JS[t]}}} {n}" for n, t in s.params)
    return {
        "python": (f"class Solution:\n"
                   f"    def {s.method}(self, {py_params}) -> {_PY[s.returns]}:\n"
                   f"        # {TODO}\n"
                   f"        pass\n"),
        "javascript": (f"class Solution {{\n"
                       f"  /**\n{js_doc}\n   * @return {{{_JS[s.returns]}}}\n   */\n"
                       f"  {s.method}({', '.join(n for n, _ in s.params)}) {{\n"
                       f"    // {TODO}\n"
                       f"  }}\n}}\n"),
        "cpp": (f"// The standard headers and `using namespace std;` are already included.\n"
                f"class Solution {{\n"
                f"public:\n"
                f"    {_CPP[s.returns]} {s.method}({', '.join(_cpp_param(n, t) for n, t in s.params)}) {{\n"
                f"        // {TODO}\n"
                f"    }}\n}};\n"),
        "java": (f"import java.util.*;\n\n"
                 f"class Solution {{\n"
                 f"    public {_JAVA[s.returns]} {s.method}({', '.join(f'{_JAVA[t]} {n}' for n, t in s.params)}) {{\n"
                 f"        // {TODO}\n"
                 f"    }}\n}}\n"),
    }


# -------------------------------------------------------------
# Hidden drivers (added after the candidate's code)
# -------------------------------------------------------------
_PY_READ = {"int": "_int()", "long": "_int()", "bool": "_bool()", "string": "_str()", "int[]": "_ints()",
            "string[]": "_strs()", "int[][]": "_grid()"}
_PY_FORMAT = {"int": "str(_r)", "long": "str(_r)", "bool": '"true" if _r else "false"', "string": "str(_r)",
              "int[]": '" ".join(map(str, _r))', "string[]": '"\\n".join(map(str, _r))',
              "int[][]": '"\\n".join(" ".join(map(str, _row)) for _row in _r)'}


def _python_driver(s: Signature) -> str:
    args = ", ".join(_PY_READ[t] for _, t in s.params)
    return f'''

# ---- test driver (added by the system) ----
def _vpl_main():
    import sys as _sys
    _d = _sys.stdin.buffer.read()
    _p = 0

    def _line():
        nonlocal _p
        _e = _d.find(b"\\n", _p)
        if _e < 0:
            _e = len(_d)
        _s = _d[_p:_e]
        _p = _e + 1
        return _s

    def _int():
        return int(_line())

    def _bool():
        return _line().strip() == b"true"

    def _str():
        nonlocal _p
        _n = _int()
        _s = _d[_p:_p + _n].decode("utf-8")
        _p += _n + 1
        return _s

    def _ints():
        _n = _int()
        return list(map(int, _line().split()))[:_n]

    def _strs():
        return [_str() for _ in range(_int())]

    def _grid():
        return [_ints() for _ in range(_int())]

    _args = [{args}]
    _r = Solution().{s.method}(*_args)
    _sys.stdout.write("\\n{MARK}\\n" + ({_PY_FORMAT[s.returns]}) + "\\n")


_vpl_main()
'''


_JS_READ = {"int": "_num()", "long": "_num()", "bool": "_bool()", "string": "_str()", "int[]": "_ints()",
            "string[]": "_strs()", "int[][]": "_grid()"}
_JS_FORMAT = {"int": "String(r)", "long": "String(r)", "bool": 'r ? "true" : "false"', "string": "String(r)",
              "int[]": 'r.join(" ")', "string[]": 'r.join("\\n")', "int[][]": 'r.map((row) => row.join(" ")).join("\\n")'}


def _javascript_driver(s: Signature) -> str:
    args = ", ".join(_JS_READ[t] for _, t in s.params)
    return f'''

// ---- test driver (added by the system) ----
(() => {{
  const d = require("fs").readFileSync(0);
  let p = 0;
  const _line = () => {{ let e = d.indexOf(10, p); if (e < 0) e = d.length; const s = d.toString("utf8", p, e); p = e + 1; return s; }};
  const _num = () => Number(_line());
  const _bool = () => _line().trim() === "true";
  const _str = () => {{ const n = _num(); const s = d.toString("utf8", p, p + n); p += n + 1; return s; }};
  const _ints = () => {{ const n = _num(); const l = _line().trim(); return n ? l.split(/\\s+/).slice(0, n).map(Number) : []; }};
  const _strs = () => Array.from({{ length: _num() }}, _str);
  const _grid = () => Array.from({{ length: _num() }}, _ints);
  const args = [{args}];
  const r = new Solution().{s.method}(...args);
  process.stdout.write("\\n{MARK}\\n" + ({_JS_FORMAT[s.returns]}) + "\\n");
}})();
'''


_CPP_READ = {"int": "(int) vpl_::num()", "long": "vpl_::num()", "bool": "vpl_::boolean()", "string": "vpl_::str()",
             "int[]": "vpl_::ints()", "string[]": "vpl_::strs()", "int[][]": "vpl_::grid()"}
CPP_PRELUDE = "#include <bits/stdc++.h>\nusing namespace std;\n#line 1\n"


def _cpp_driver(s: Signature) -> str:
    reads = "\n".join(f"    {_CPP[t]} a{i} = {_CPP_READ[t]};" for i, (_, t) in enumerate(s.params))
    call = ", ".join(f"a{i}" for i in range(len(s.params)))
    return f'''

#line 1 "(test driver)"
namespace vpl_ {{
static std::string d;
static size_t p = 0;
static std::string line() {{
    size_t e = d.find('\\n', p);
    if (e == std::string::npos) e = d.size();
    std::string s = d.substr(p, e - p);
    p = e + 1;
    return s;
}}
static long long num() {{ return std::stoll(line()); }}
static bool boolean() {{ std::string s = line(); return s.rfind("true", 0) == 0; }}
static std::string str() {{ size_t n = (size_t) num(); std::string s = d.substr(p, n); p += n + 1; return s; }}
static std::vector<int> ints() {{
    size_t n = (size_t) num();
    std::vector<int> v;
    v.reserve(n);
    size_t e = d.find('\\n', p);
    if (e == std::string::npos) e = d.size();
    const char* c = d.c_str() + p;
    const char* end = d.c_str() + e;
    while (v.size() < n && c < end) {{
        char* next;
        long long x = std::strtoll(c, &next, 10);
        if (next == c) break;
        v.push_back((int) x);
        c = next;
    }}
    p = e + 1;
    return v;
}}
static std::vector<std::string> strs() {{ size_t n = (size_t) num(); std::vector<std::string> v; for (size_t i = 0; i < n; i++) v.push_back(str()); return v; }}
static std::vector<std::vector<int>> grid() {{ size_t n = (size_t) num(); std::vector<std::vector<int>> v; for (size_t i = 0; i < n; i++) v.push_back(ints()); return v; }}
static void put(std::string& o, long long x) {{ o += std::to_string(x); }}
static void put(std::string& o, bool x) {{ o += x ? "true" : "false"; }}
static void put(std::string& o, const std::string& x) {{ o += x; }}
static void put(std::string& o, const std::vector<int>& x) {{ for (size_t i = 0; i < x.size(); i++) {{ if (i) o += ' '; o += std::to_string(x[i]); }} }}
static void put(std::string& o, const std::vector<std::string>& x) {{ for (size_t i = 0; i < x.size(); i++) {{ if (i) o += '\\n'; o += x[i]; }} }}
static void put(std::string& o, const std::vector<std::vector<int>>& x) {{ for (size_t i = 0; i < x.size(); i++) {{ if (i) o += '\\n'; put(o, x[i]); }} }}
}}

int main() {{
    {{ std::ostringstream all; all << std::cin.rdbuf(); vpl_::d = all.str(); }}
{reads}
    Solution vpl_solution;
    {_CPP[s.returns]} vpl_result = vpl_solution.{s.method}({call});
    std::string vpl_out;
    vpl_::put(vpl_out, {"(long long) " if s.returns in ("int", "long") else ""}vpl_result);
    std::cout << "\\n{MARK}\\n" << vpl_out << "\\n";
    std::cout.flush();
    return 0;
}}
'''


_JAVA_READ = {"int": "(int) num()", "long": "num()", "bool": "bool()", "string": "str()", "int[]": "ints()",
              "string[]": "strs()", "int[][]": "grid()"}


def _java_driver(s: Signature) -> str:
    reads = "\n".join(f"        {_JAVA[t]} a{i} = {_JAVA_READ[t]};" for i, (_, t) in enumerate(s.params))
    call = ", ".join(f"a{i}" for i in range(len(s.params)))
    return f'''

// ---- test driver (added by the system) ----
public class Main {{
    static byte[] d;
    static int p = 0;

    static String line() {{
        int s = p;
        while (p < d.length && d[p] != '\\n') p++;
        String r = new String(d, s, p - s, java.nio.charset.StandardCharsets.UTF_8);
        p++;
        return r;
    }}

    static long num() {{ return Long.parseLong(line().trim()); }}

    static boolean bool() {{ return line().trim().equals("true"); }}

    static String str() {{
        int n = (int) num();
        String r = new String(d, p, n, java.nio.charset.StandardCharsets.UTF_8);
        p += n + 1;
        return r;
    }}

    static int[] ints() {{
        int n = (int) num();
        int[] v = new int[n];
        for (int i = 0; i < n; i++) {{
            while (d[p] == ' ') p++;
            boolean neg = d[p] == '-';
            if (neg) p++;
            long x = 0;
            while (p < d.length && d[p] >= '0' && d[p] <= '9') x = x * 10 + (d[p++] - '0');
            v[i] = (int) (neg ? -x : x);
        }}
        while (p < d.length && d[p] != '\\n') p++;
        p++;
        return v;
    }}

    static String[] strs() {{ int n = (int) num(); String[] v = new String[n]; for (int i = 0; i < n; i++) v[i] = str(); return v; }}

    static int[][] grid() {{ int n = (int) num(); int[][] v = new int[n][]; for (int i = 0; i < n; i++) v[i] = ints(); return v; }}

    static void put(StringBuilder o, long x) {{ o.append(x); }}
    static void put(StringBuilder o, boolean x) {{ o.append(x ? "true" : "false"); }}
    static void put(StringBuilder o, String x) {{ o.append(x); }}
    static void put(StringBuilder o, int[] x) {{ for (int i = 0; i < x.length; i++) {{ if (i > 0) o.append(' '); o.append(x[i]); }} }}
    static void put(StringBuilder o, String[] x) {{ for (int i = 0; i < x.length; i++) {{ if (i > 0) o.append('\\n'); o.append(x[i]); }} }}
    static void put(StringBuilder o, int[][] x) {{ for (int i = 0; i < x.length; i++) {{ if (i > 0) o.append('\\n'); put(o, x[i]); }} }}

    public static void main(String[] args) throws Exception {{
        d = System.in.readAllBytes();
{reads}
        {_JAVA[s.returns]} result = new Solution().{s.method}({call});
        StringBuilder o = new StringBuilder();
        put(o, result);
        System.out.print("\\n{MARK}\\n" + o + "\\n");
        System.out.flush();
    }}
}}
'''


_DRIVERS = {"python": _python_driver, "javascript": _javascript_driver, "cpp": _cpp_driver, "java": _java_driver}
_PUBLIC_SOLUTION = re.compile(r"\bpublic\s+((?:final\s+)?class\s+Solution\b)")


def program(signature: Signature, language: str, code: str) -> str:
    """The complete program that runs: the candidate's code plus the driver."""
    if language not in _DRIVERS:
        raise code_runner.RunnerError(f"Unsupported language '{language}'.")
    if language == "cpp":
        return CPP_PRELUDE + code + _cpp_driver(signature)
    if language == "java":
        # `public class Solution` would have to live in Solution.java.
        code = _PUBLIC_SOLUTION.sub(r"\1", code)
    return code + _DRIVERS[language](signature)


def run(signature: Signature, language: str, code: str, tests: list[dict], time_limit: Optional[float] = None) -> dict:
    """code_runner.run_tests for a function-style solution.

    Each result's ``stdout`` is the returned value (as printed tokens) and
    ``printed`` is whatever the candidate printed themselves."""
    return code_runner.run_tests(language, program(signature, language, code), tests, time_limit, marker=MARK)
