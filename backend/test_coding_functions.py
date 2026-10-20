# Function-style coding problems: drivers, starter code, values and grading.
#
# Every bank problem is solved in Python, JavaScript, C++ and Java through
# the hidden drivers and must pass every test, hidden and large ones
# included. A language whose compiler is not installed is skipped.
import shutil
import unittest

import code_runner
import coding
import coding_bank
import coding_functions as cf

PY = {
    "two-sum": """
class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for j, v in enumerate(nums):
            if target - v in seen:
                return [seen[target - v], j]
            seen.setdefault(v, j)
        return [-1, -1]
""",
    "valid-brackets": """
class Solution:
    def isValid(self, s):
        pairs, stack = {")": "(", "]": "[", "}": "{"}, []
        for ch in s:
            if ch in "([{":
                stack.append(ch)
            elif not stack or stack.pop() != pairs[ch]:
                return False
        return not stack
""",
    "valid-palindrome": """
class Solution:
    def isPalindrome(self, s):
        t = [c.lower() for c in s if c.isalnum()]
        return t == t[::-1]
""",
    "second-largest": """
class Solution:
    def secondLargest(self, nums):
        d = sorted(set(nums), reverse=True)
        return d[1] if len(d) > 1 else -1
""",
    "missing-number": """
class Solution:
    def missingNumber(self, nums):
        n = len(nums)
        return n * (n + 1) // 2 - sum(nums)
""",
    "max-subarray": """
class Solution:
    def maxSubarraySum(self, nums):
        best = cur = nums[0]
        for v in nums[1:]:
            cur = max(v, cur + v)
            best = max(best, cur)
        return best
""",
    "longest-unique-substring": """
class Solution:
    def lengthOfLongestSubstring(self, s):
        last, start, best = {}, 0, 0
        for i, ch in enumerate(s):
            if last.get(ch, -1) >= start:
                start = last[ch] + 1
            last[ch] = i
            best = max(best, i - start + 1)
        return best
""",
    "merge-intervals": """
class Solution:
    def merge(self, intervals):
        out = []
        for l, r in sorted(intervals):
            if out and l <= out[-1][1]:
                out[-1][1] = max(out[-1][1], r)
            else:
                out.append([l, r])
        return out
""",
    "number-of-islands": """
class Solution:
    def numIslands(self, grid):
        g = [list(row) for row in grid]
        rows, cols, count = len(g), len(g[0]), 0
        for r in range(rows):
            for c in range(cols):
                if g[r][c] != "1":
                    continue
                count += 1
                g[r][c] = "0"
                stack = [(r, c)]
                while stack:
                    y, x = stack.pop()
                    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= ny < rows and 0 <= nx < cols and g[ny][nx] == "1":
                            g[ny][nx] = "0"
                            stack.append((ny, nx))
        return count
""",
    "coin-change": """
class Solution:
    def coinChange(self, coins, amount):
        inf = amount + 1
        best = [0] + [inf] * amount
        for v in range(1, amount + 1):
            for c in coins:
                if c <= v and best[v - c] + 1 < best[v]:
                    best[v] = best[v - c] + 1
        return best[amount] if best[amount] <= amount else -1
""",
    "daily-temperatures": """
class Solution:
    def dailyTemperatures(self, temperatures):
        ans, stack = [0] * len(temperatures), []
        for i, t in enumerate(temperatures):
            while stack and temperatures[stack[-1]] < t:
                j = stack.pop()
                ans[j] = i - j
            stack.append(i)
        return ans
""",
    "longest-increasing-subsequence": """
import bisect


class Solution:
    def lengthOfLIS(self, nums):
        tails = []
        for v in nums:
            i = bisect.bisect_left(tails, v)
            if i == len(tails):
                tails.append(v)
            else:
                tails[i] = v
        return len(tails)
""",
    "edit-distance": """
class Solution:
    def minDistance(self, word1, word2):
        prev = list(range(len(word2) + 1))
        for i in range(1, len(word1) + 1):
            cur = [i] + [0] * len(word2)
            for j in range(1, len(word2) + 1):
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (word1[i - 1] != word2[j - 1]))
            prev = cur
        return prev[-1]
""",
    "shortest-paths": """
import heapq


class Solution:
    def shortestPaths(self, n, edges, source):
        graph = [[] for _ in range(n + 1)]
        for u, v, w in edges:
            graph[u].append((v, w))
            graph[v].append((u, w))
        dist = [-1] * (n + 1)
        heap = [(0, source)]
        while heap:
            d, x = heapq.heappop(heap)
            if dist[x] != -1:
                continue
            dist[x] = d
            for y, w in graph[x]:
                if dist[y] == -1:
                    heapq.heappush(heap, (d + w, y))
        return dist[1:]
""",
    "trapping-rain-water": """
class Solution:
    def trap(self, height):
        l, r, lm, rm, water = 0, len(height) - 1, 0, 0, 0
        while l < r:
            if height[l] < height[r]:
                lm = max(lm, height[l])
                water += lm - height[l]
                l += 1
            else:
                rm = max(rm, height[r])
                water += rm - height[r]
                r -= 1
        return water
""",
}

JS = {
    "two-sum": """class Solution {
  twoSum(nums, target) {
    const seen = new Map();
    for (let j = 0; j < nums.length; j++) {
      if (seen.has(target - nums[j])) return [seen.get(target - nums[j]), j];
      if (!seen.has(nums[j])) seen.set(nums[j], j);
    }
    return [-1, -1];
  }
}""",
    "valid-brackets": """class Solution {
  isValid(s) {
    const pairs = { ')': '(', ']': '[', '}': '{' }, stack = [];
    for (const ch of s) {
      if ('([{'.includes(ch)) stack.push(ch);
      else if (!stack.length || stack.pop() !== pairs[ch]) return false;
    }
    return stack.length === 0;
  }
}""",
    "valid-palindrome": """class Solution {
  isPalindrome(s) {
    const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return t === [...t].reverse().join('');
  }
}""",
    "second-largest": """class Solution {
  secondLargest(nums) {
    let a = -Infinity, b = -Infinity;
    for (const v of nums) { if (v > a) { b = a; a = v; } else if (v < a && v > b) b = v; }
    return b === -Infinity ? -1 : b;
  }
}""",
    "missing-number": """class Solution {
  missingNumber(nums) {
    const n = nums.length;
    return n * (n + 1) / 2 - nums.reduce((s, v) => s + v, 0);
  }
}""",
    "max-subarray": """class Solution {
  maxSubarraySum(nums) {
    let best = nums[0], cur = nums[0];
    for (let i = 1; i < nums.length; i++) { cur = Math.max(nums[i], cur + nums[i]); best = Math.max(best, cur); }
    return best;
  }
}""",
    "longest-unique-substring": """class Solution {
  lengthOfLongestSubstring(s) {
    const last = new Map(); let start = 0, best = 0;
    for (let i = 0; i < s.length; i++) {
      if (last.has(s[i]) && last.get(s[i]) >= start) start = last.get(s[i]) + 1;
      last.set(s[i], i); best = Math.max(best, i - start + 1);
    }
    return best;
  }
}""",
    "merge-intervals": """class Solution {
  merge(intervals) {
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const [l, r] of intervals) {
      if (out.length && l <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r);
      else out.push([l, r]);
    }
    return out;
  }
}""",
    "number-of-islands": """class Solution {
  numIslands(grid) {
    const g = grid.map((row) => row.split('')), rows = g.length, cols = g[0].length;
    let count = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (g[r][c] !== '1') continue;
      count++; g[r][c] = '0';
      const stack = [[r, c]];
      while (stack.length) {
        const [y, x] = stack.pop();
        for (const [ny, nx] of [[y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]]) {
          if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && g[ny][nx] === '1') { g[ny][nx] = '0'; stack.push([ny, nx]); }
        }
      }
    }
    return count;
  }
}""",
    "coin-change": """class Solution {
  coinChange(coins, amount) {
    const best = new Array(amount + 1).fill(amount + 1); best[0] = 0;
    for (let v = 1; v <= amount; v++) for (const c of coins) if (c <= v && best[v - c] + 1 < best[v]) best[v] = best[v - c] + 1;
    return best[amount] > amount ? -1 : best[amount];
  }
}""",
    "daily-temperatures": """class Solution {
  dailyTemperatures(t) {
    const ans = new Array(t.length).fill(0), stack = [];
    for (let i = 0; i < t.length; i++) {
      while (stack.length && t[stack[stack.length - 1]] < t[i]) { const j = stack.pop(); ans[j] = i - j; }
      stack.push(i);
    }
    return ans;
  }
}""",
    "longest-increasing-subsequence": """class Solution {
  lengthOfLIS(nums) {
    const tails = [];
    for (const v of nums) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
      tails[lo] = v;
    }
    return tails.length;
  }
}""",
    "edit-distance": """class Solution {
  minDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
      prev = cur;
    }
    return prev[b.length];
  }
}""",
    "shortest-paths": """class Solution {
  shortestPaths(n, edges, source) {
    const graph = Array.from({ length: n + 1 }, () => []);
    for (const [u, v, w] of edges) { graph[u].push([v, w]); graph[v].push([u, w]); }
    const dist = new Array(n + 1).fill(-1), heap = [[0, source]];
    const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, x] = pop();
      if (dist[x] !== -1) continue;
      dist[x] = d;
      for (const [y, w] of graph[x]) if (dist[y] === -1) push([d + w, y]);
    }
    return dist.slice(1);
  }
}""",
    "trapping-rain-water": """class Solution {
  trap(h) {
    let l = 0, r = h.length - 1, lm = 0, rm = 0, water = 0;
    while (l < r) {
      if (h[l] < h[r]) { lm = Math.max(lm, h[l]); water += lm - h[l]; l++; }
      else { rm = Math.max(rm, h[r]); water += rm - h[r]; r--; }
    }
    return water;
  }
}""",
}

CPP = {
    "two-sum": """class Solution {
public:
    vector<int> twoSum(vector<int>& nums, long long target) {
        unordered_map<long long, int> seen;
        for (int j = 0; j < (int) nums.size(); j++) {
            auto it = seen.find(target - nums[j]);
            if (it != seen.end()) return {it->second, j};
            seen.emplace(nums[j], j);
        }
        return {-1, -1};
    }
};""",
    "valid-brackets": """class Solution {
public:
    bool isValid(string s) {
        string st;
        for (char c : s) {
            if (c == '(' || c == '[' || c == '{') st.push_back(c);
            else {
                char want = c == ')' ? '(' : c == ']' ? '[' : '{';
                if (st.empty() || st.back() != want) return false;
                st.pop_back();
            }
        }
        return st.empty();
    }
};""",
    "valid-palindrome": """class Solution {
public:
    bool isPalindrome(string s) {
        int i = 0, j = (int) s.size() - 1;
        while (i < j) {
            if (!isalnum((unsigned char) s[i])) { i++; continue; }
            if (!isalnum((unsigned char) s[j])) { j--; continue; }
            if (tolower(s[i]) != tolower(s[j])) return false;
            i++; j--;
        }
        return true;
    }
};""",
    "second-largest": """class Solution {
public:
    int secondLargest(vector<int>& nums) {
        long long a = LLONG_MIN, b = LLONG_MIN;
        for (int v : nums) { if (v > a) { b = a; a = v; } else if (v < a && v > b) b = v; }
        return b == LLONG_MIN ? -1 : (int) b;
    }
};""",
    "missing-number": """class Solution {
public:
    int missingNumber(vector<int>& nums) {
        long long n = nums.size(), s = n * (n + 1) / 2;
        for (int v : nums) s -= v;
        return (int) s;
    }
};""",
    "max-subarray": """class Solution {
public:
    int maxSubarraySum(vector<int>& nums) {
        long long best = nums[0], cur = nums[0];
        for (size_t i = 1; i < nums.size(); i++) { cur = max<long long>(nums[i], cur + nums[i]); best = max(best, cur); }
        return (int) best;
    }
};""",
    "longest-unique-substring": """class Solution {
public:
    int lengthOfLongestSubstring(string s) {
        vector<int> last(256, -1);
        int start = 0, best = 0;
        for (int i = 0; i < (int) s.size(); i++) {
            unsigned char c = s[i];
            if (last[c] >= start) start = last[c] + 1;
            last[c] = i;
            best = max(best, i - start + 1);
        }
        return best;
    }
};""",
    "merge-intervals": """class Solution {
public:
    vector<vector<int>> merge(vector<vector<int>>& intervals) {
        sort(intervals.begin(), intervals.end());
        vector<vector<int>> out;
        for (auto& iv : intervals) {
            if (!out.empty() && iv[0] <= out.back()[1]) out.back()[1] = max(out.back()[1], iv[1]);
            else out.push_back(iv);
        }
        return out;
    }
};""",
    "number-of-islands": """class Solution {
public:
    int numIslands(vector<string>& grid) {
        int rows = grid.size(), cols = grid[0].size(), count = 0;
        vector<pair<int, int>> st;
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
            if (grid[r][c] != '1') continue;
            count++; grid[r][c] = '0'; st.push_back({r, c});
            while (!st.empty()) {
                auto [y, x] = st.back(); st.pop_back();
                int dy[] = {1, -1, 0, 0}, dx[] = {0, 0, 1, -1};
                for (int k = 0; k < 4; k++) {
                    int ny = y + dy[k], nx = x + dx[k];
                    if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny][nx] == '1') { grid[ny][nx] = '0'; st.push_back({ny, nx}); }
                }
            }
        }
        return count;
    }
};""",
    "coin-change": """class Solution {
public:
    int coinChange(vector<int>& coins, int amount) {
        vector<int> best(amount + 1, amount + 1);
        best[0] = 0;
        for (int v = 1; v <= amount; v++) for (int c : coins) if (c <= v) best[v] = min(best[v], best[v - c] + 1);
        return best[amount] > amount ? -1 : best[amount];
    }
};""",
    "daily-temperatures": """class Solution {
public:
    vector<int> dailyTemperatures(vector<int>& t) {
        vector<int> ans(t.size()), st;
        for (int i = 0; i < (int) t.size(); i++) {
            while (!st.empty() && t[st.back()] < t[i]) { ans[st.back()] = i - st.back(); st.pop_back(); }
            st.push_back(i);
        }
        return ans;
    }
};""",
    "longest-increasing-subsequence": """class Solution {
public:
    int lengthOfLIS(vector<int>& nums) {
        vector<int> tails;
        for (int v : nums) {
            auto it = lower_bound(tails.begin(), tails.end(), v);
            if (it == tails.end()) tails.push_back(v); else *it = v;
        }
        return tails.size();
    }
};""",
    "edit-distance": """class Solution {
public:
    int minDistance(string a, string b) {
        vector<int> prev(b.size() + 1), cur(b.size() + 1);
        for (size_t j = 0; j <= b.size(); j++) prev[j] = j;
        for (size_t i = 1; i <= a.size(); i++) {
            cur[0] = i;
            for (size_t j = 1; j <= b.size(); j++) cur[j] = min({prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])});
            swap(prev, cur);
        }
        return prev[b.size()];
    }
};""",
    "shortest-paths": """class Solution {
public:
    vector<int> shortestPaths(int n, vector<vector<int>>& edges, int source) {
        vector<vector<pair<int, int>>> g(n + 1);
        for (auto& e : edges) { g[e[0]].push_back({e[1], e[2]}); g[e[1]].push_back({e[0], e[2]}); }
        vector<int> dist(n + 1, -1);
        priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> pq;
        pq.push({0, source});
        while (!pq.empty()) {
            auto [d, x] = pq.top(); pq.pop();
            if (dist[x] != -1) continue;
            dist[x] = d;
            for (auto [y, w] : g[x]) if (dist[y] == -1) pq.push({d + w, y});
        }
        return vector<int>(dist.begin() + 1, dist.end());
    }
};""",
    "trapping-rain-water": """class Solution {
public:
    int trap(vector<int>& h) {
        int l = 0, r = (int) h.size() - 1, lm = 0, rm = 0;
        long long water = 0;
        while (l < r) {
            if (h[l] < h[r]) { lm = max(lm, h[l]); water += lm - h[l]; l++; }
            else { rm = max(rm, h[r]); water += rm - h[r]; r--; }
        }
        return (int) water;
    }
};""",
}

JAVA = {
    "two-sum": """import java.util.*;

class Solution {
    public int[] twoSum(int[] nums, long target) {
        Map<Long, Integer> seen = new HashMap<>();
        for (int j = 0; j < nums.length; j++) {
            Integer i = seen.get(target - nums[j]);
            if (i != null) return new int[]{i, j};
            seen.putIfAbsent((long) nums[j], j);
        }
        return new int[]{-1, -1};
    }
}""",
    "valid-brackets": """import java.util.*;

class Solution {
    public boolean isValid(String s) {
        Deque<Character> st = new ArrayDeque<>();
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') st.push(c);
            else {
                char want = c == ')' ? '(' : c == ']' ? '[' : '{';
                if (st.isEmpty() || st.pop() != want) return false;
            }
        }
        return st.isEmpty();
    }
}""",
    "valid-palindrome": """class Solution {
    public boolean isPalindrome(String s) {
        int i = 0, j = s.length() - 1;
        while (i < j) {
            char a = s.charAt(i), b = s.charAt(j);
            if (!Character.isLetterOrDigit(a)) { i++; continue; }
            if (!Character.isLetterOrDigit(b)) { j--; continue; }
            if (Character.toLowerCase(a) != Character.toLowerCase(b)) return false;
            i++; j--;
        }
        return true;
    }
}""",
    "second-largest": """class Solution {
    public int secondLargest(int[] nums) {
        long a = Long.MIN_VALUE, b = Long.MIN_VALUE;
        for (int v : nums) { if (v > a) { b = a; a = v; } else if (v < a && v > b) b = v; }
        return b == Long.MIN_VALUE ? -1 : (int) b;
    }
}""",
    "missing-number": """class Solution {
    public int missingNumber(int[] nums) {
        long n = nums.length, s = n * (n + 1) / 2;
        for (int v : nums) s -= v;
        return (int) s;
    }
}""",
    "max-subarray": """class Solution {
    public int maxSubarraySum(int[] nums) {
        long best = nums[0], cur = nums[0];
        for (int i = 1; i < nums.length; i++) { cur = Math.max(nums[i], cur + nums[i]); best = Math.max(best, cur); }
        return (int) best;
    }
}""",
    "longest-unique-substring": """class Solution {
    public int lengthOfLongestSubstring(String s) {
        int[] last = new int[128];
        java.util.Arrays.fill(last, -1);
        int start = 0, best = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (last[c] >= start) start = last[c] + 1;
            last[c] = i;
            best = Math.max(best, i - start + 1);
        }
        return best;
    }
}""",
    "merge-intervals": """import java.util.*;

class Solution {
    public int[][] merge(int[][] intervals) {
        Arrays.sort(intervals, (a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        List<int[]> out = new ArrayList<>();
        for (int[] iv : intervals) {
            if (!out.isEmpty() && iv[0] <= out.get(out.size() - 1)[1]) out.get(out.size() - 1)[1] = Math.max(out.get(out.size() - 1)[1], iv[1]);
            else out.add(new int[]{iv[0], iv[1]});
        }
        return out.toArray(new int[0][]);
    }
}""",
    "number-of-islands": """import java.util.*;

class Solution {
    public int numIslands(String[] grid) {
        int rows = grid.length, cols = grid[0].length(), count = 0;
        char[][] g = new char[rows][];
        for (int r = 0; r < rows; r++) g[r] = grid[r].toCharArray();
        int[] stack = new int[rows * cols];
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
            if (g[r][c] != '1') continue;
            count++; g[r][c] = '0';
            int top = 0; stack[top++] = r * cols + c;
            while (top > 0) {
                int cell = stack[--top], y = cell / cols, x = cell % cols;
                int[][] next = {{y + 1, x}, {y - 1, x}, {y, x + 1}, {y, x - 1}};
                for (int[] p : next) {
                    if (p[0] >= 0 && p[0] < rows && p[1] >= 0 && p[1] < cols && g[p[0]][p[1]] == '1') { g[p[0]][p[1]] = '0'; stack[top++] = p[0] * cols + p[1]; }
                }
            }
        }
        return count;
    }
}""",
    "coin-change": """class Solution {
    public int coinChange(int[] coins, int amount) {
        int[] best = new int[amount + 1];
        java.util.Arrays.fill(best, amount + 1);
        best[0] = 0;
        for (int v = 1; v <= amount; v++) for (int c : coins) if (c <= v) best[v] = Math.min(best[v], best[v - c] + 1);
        return best[amount] > amount ? -1 : best[amount];
    }
}""",
    "daily-temperatures": """class Solution {
    public int[] dailyTemperatures(int[] t) {
        int[] ans = new int[t.length], st = new int[t.length];
        int top = 0;
        for (int i = 0; i < t.length; i++) {
            while (top > 0 && t[st[top - 1]] < t[i]) { int j = st[--top]; ans[j] = i - j; }
            st[top++] = i;
        }
        return ans;
    }
}""",
    "longest-increasing-subsequence": """class Solution {
    public int lengthOfLIS(int[] nums) {
        int[] tails = new int[nums.length];
        int size = 0;
        for (int v : nums) {
            int lo = 0, hi = size;
            while (lo < hi) { int mid = (lo + hi) >>> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
            tails[lo] = v;
            if (lo == size) size++;
        }
        return size;
    }
}""",
    "edit-distance": """class Solution {
    public int minDistance(String a, String b) {
        int[] prev = new int[b.length() + 1], cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++)
                cur[j] = Math.min(Math.min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a.charAt(i - 1) != b.charAt(j - 1) ? 1 : 0));
            int[] tmp = prev; prev = cur; cur = tmp;
        }
        return prev[b.length()];
    }
}""",
    "shortest-paths": """import java.util.*;

class Solution {
    public int[] shortestPaths(int n, int[][] edges, int source) {
        List<List<int[]>> g = new ArrayList<>();
        for (int i = 0; i <= n; i++) g.add(new ArrayList<>());
        for (int[] e : edges) { g.get(e[0]).add(new int[]{e[1], e[2]}); g.get(e[1]).add(new int[]{e[0], e[2]}); }
        int[] dist = new int[n + 1];
        Arrays.fill(dist, -1);
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, source});
        while (!pq.isEmpty()) {
            long[] top = pq.poll();
            int x = (int) top[1];
            if (dist[x] != -1) continue;
            dist[x] = (int) top[0];
            for (int[] e : g.get(x)) if (dist[e[0]] == -1) pq.add(new long[]{top[0] + e[1], e[0]});
        }
        return Arrays.copyOfRange(dist, 1, n + 1);
    }
}""",
    "trapping-rain-water": """class Solution {
    public int trap(int[] h) {
        int l = 0, r = h.length - 1, lm = 0, rm = 0;
        long water = 0;
        while (l < r) {
            if (h[l] < h[r]) { lm = Math.max(lm, h[l]); water += lm - h[l]; l++; }
            else { rm = Math.max(rm, h[r]); water += rm - h[r]; r--; }
        }
        return (int) water;
    }
}""",
}

SOLUTIONS = {"python": PY, "javascript": JS, "cpp": CPP, "java": JAVA}
INSTALLED = {"python": True, "javascript": bool(shutil.which("node")), "cpp": bool(shutil.which("g++")),
             "java": bool(shutil.which("javac"))}
# Generous limit: several suites may run on a busy machine at once.
TIME_LIMIT = 6


class EveryProblemInEveryLanguageTests(unittest.TestCase):
    def test_solutions_cover_the_whole_bank(self):
        for language, solutions in SOLUTIONS.items():
            self.assertEqual(set(solutions), set(coding_bank.BY_ID), language)

    def check_language(self, language):
        if not INSTALLED[language]:
            self.skipTest(f"{language} is not installed")
        for problem in coding_bank.PROBLEMS:
            with self.subTest(language=language, problem=problem.id):
                spec = coding_bank.FUNCTIONS[problem.id]
                tests = coding_bank.function_tests(problem)
                run = cf.run(spec.signature, language, SOLUTIONS[language][problem.id], tests, time_limit=TIME_LIMIT)
                self.assertTrue(run["compiled"], run["compile_output"])
                failed = [(i, r["status"], r["stderr"][-300:]) for i, r in enumerate(run["results"]) if r["status"] != "passed"]
                self.assertEqual(failed, [])

    def test_python(self):
        self.check_language("python")

    def test_javascript(self):
        self.check_language("javascript")

    def test_cpp(self):
        self.check_language("cpp")

    def test_java(self):
        self.check_language("java")


class BankTests(unittest.TestCase):
    def test_arguments_convert_both_ways_with_the_same_answer(self):
        for problem in coding_bank.PROBLEMS:
            spec = coding_bank.FUNCTIONS[problem.id]
            for test in coding_bank.tests(problem):
                with self.subTest(problem=problem.id):
                    args = spec.to_args(test["input"])
                    self.assertEqual(problem.solve(spec.to_text(*args)), test["expected"])

    def test_public_view_is_function_style(self):
        public = coding_bank.public(coding_bank.BY_ID["two-sum"])
        self.assertEqual(public["mode"], "function")
        self.assertEqual(public["signature"]["method"], "twoSum")
        example = public["examples"][0]
        self.assertEqual(example["args"], [{"name": "nums", "value": "[2,7,11,15]"}, {"name": "target", "value": "9"}])
        self.assertEqual(example["expected_display"], "[0,1]")
        for language, code in public["starter_code"].items():
            self.assertIn("class Solution", code, language)
            self.assertIn("twoSum", code, language)
            self.assertNotIn("cin", code)
            self.assertNotIn("stdin", code)

    def test_starters_compile_and_count_as_untouched(self):
        public = coding_bank.public(coding_bank.BY_ID["missing-number"])
        for language in ("python", "javascript"):
            run = coding.run(public, language, public["starter_code"][language], coding.examples_for(public))
            self.assertTrue(run["compiled"])
            self.assertEqual(run["passed"], 0)
            self.assertTrue(coding.is_untouched(public, language, public["starter_code"][language]))


class DriverBehaviourTests(unittest.TestCase):
    signature = cf.Signature("echo", (("words", "string[]"), ("text", "string"), ("flag", "bool"), ("big", "long")), "string[]")

    def test_values_survive_the_round_trip(self):
        # Spaces, empty strings and non-ASCII text arrive exactly as sent.
        code = "class Solution:\n    def echo(self, words, text, flag, big):\n        return words + [text, str(flag), str(big)]\n"
        args = [["a b", "", "héllo"], "  two  spaces ", True, 9_000_000_000]
        run = cf.run(self.signature, "python", code, [{"input": cf.encode(self.signature, args)}])
        self.assertEqual(run["results"][0]["status"], "ran")
        self.assertEqual(run["results"][0]["stdout"].strip("\n").split("\n"),
                         ["a b", "", "héllo", "  two  spaces ", "True", "9000000000"])

    def test_printing_is_kept_apart_from_the_returned_value(self):
        sig = cf.Signature("twice", (("x", "int"),), "int")
        code = "class Solution:\n    def twice(self, x):\n        print('thinking...', x)\n        return 2 * x\n"
        run = cf.run(sig, "python", code, [{"input": cf.encode(sig, [21]), "expected": "42"}])
        self.assertEqual(run["results"][0]["status"], "passed")
        self.assertEqual(run["results"][0]["printed"], "thinking... 21")

    def test_wrong_answer_runtime_error_and_early_exit(self):
        sig = cf.Signature("twice", (("x", "int"),), "int")
        test = [{"input": cf.encode(sig, [21]), "expected": "42"}]
        wrong = cf.run(sig, "python", "class Solution:\n    def twice(self, x):\n        return x\n", test)
        crash = cf.run(sig, "python", "class Solution:\n    def twice(self, x):\n        return 1 // 0\n", test)
        exits = cf.run(sig, "python", "import os\nclass Solution:\n    def twice(self, x):\n        print(42)\n        os._exit(0)\n", test)
        self.assertEqual(wrong["results"][0]["status"], "wrong_answer")
        self.assertEqual(crash["results"][0]["status"], "runtime_error")
        self.assertEqual(exits["results"][0]["status"], "runtime_error")  # printing the answer is not returning it

    @unittest.skipUnless(shutil.which("g++"), "g++ is not installed")
    def test_cpp_errors_point_at_the_candidates_own_line(self):
        sig = cf.Signature("twice", (("x", "int"),), "int")
        code = "class Solution {\npublic:\n    int twice(int x) {\n        return 2 * x\n    }\n};\n"
        run = cf.run(sig, "cpp", code, [{"input": "1\n"}])
        self.assertFalse(run["compiled"])
        self.assertIn("main.cpp:5:", run["compile_output"])  # the line with the closing brace

    @unittest.skipUnless(shutil.which("javac"), "javac is not installed")
    def test_java_public_solution_class_is_accepted(self):
        sig = cf.Signature("twice", (("x", "int"),), "int")
        code = "public class Solution {\n    public int twice(int x) { return 2 * x; }\n}\n"
        run = cf.run(sig, "java", code, [{"input": "21\n", "expected": "42"}])
        self.assertEqual(run["results"][0]["status"], "passed", run["compile_output"])


class ValueTests(unittest.TestCase):
    def test_custom_arguments_are_checked(self):
        self.assertEqual(cf.parse_literal("nums", "int[]", "[1, 2, 3]"), [1, 2, 3])
        self.assertEqual(cf.parse_literal("s", "string", "plain text"), "plain text")
        self.assertEqual(cf.parse_literal("s", "string", '"quoted"'), "quoted")
        self.assertEqual(cf.parse_literal("grid", "int[][]", "[[1,2],[3]]"), [[1, 2], [3]])
        with self.assertRaisesRegex(ValueError, "nums must be a int"):
            cf.parse_literal("nums", "int[]", "[1, 'x']")
        with self.assertRaises(ValueError):
            cf.parse_literal("n", "int", str(2 ** 40))

    def test_display(self):
        self.assertEqual(cf.display("int[]", "\n0 1\n"), "[0,1]")
        self.assertEqual(cf.display("int[][]", "1 6\n8 10"), "[[1,6],[8,10]]")
        self.assertEqual(cf.display("bool", "true\n"), "true")
        self.assertEqual(cf.display("int[]", ""), "[]")

    def test_signature_validation(self):
        with self.assertRaises(ValueError):
            cf.Signature.from_dict({"method": "x; drop", "params": [{"name": "a", "type": "int"}], "returns": "int"})
        with self.assertRaises(ValueError):
            cf.Signature.from_dict({"method": "f", "params": [{"name": "a", "type": "float"}], "returns": "int"})

    def test_custom_test_for_a_bank_problem_has_the_expected_answer(self):
        problem = coding_bank.BY_ID["two-sum"]
        public, private = coding_bank.public(problem), {"source": "bank", "problem_id": problem.id, "mode": "function"}
        test = coding.custom_test(public, private, None, {"nums": "[1, 5, 3]", "target": "8"})
        self.assertEqual(test["expected"], "1 2")
        with self.assertRaises(ValueError):
            coding.custom_test(public, private, None, {"nums": "oops", "target": "8"})

    def test_questions_saved_before_function_mode_still_grade_as_programs(self):
        problem = coding_bank.BY_ID["missing-number"]
        legacy_private = {"source": "bank", "problem_id": problem.id}
        self.assertEqual(coding.tests_for(legacy_private), coding_bank.tests(problem))
        program = "n=int(input());a=list(map(int,input().split()));print(n*(n+1)//2-sum(a))\n"
        run = coding.run({"title": "Missing Number"}, "python", program, coding_bank.tests(problem)[:3])
        self.assertEqual(run["passed"], 3)
        self.assertEqual(coding.shown_output({}, run["results"][0]), run["results"][0]["stdout"])


if __name__ == "__main__":
    unittest.main()


class RunnerLimitTests(unittest.TestCase):
    def test_runner_accepts_the_largest_bank_test(self):
        import runner_service
        limit = runner_service.Test.model_fields["input"].metadata[0].max_length
        largest = max(len(t["input"]) for p in coding_bank.PROBLEMS for t in coding_bank.function_tests(p))
        self.assertLess(largest, limit)
