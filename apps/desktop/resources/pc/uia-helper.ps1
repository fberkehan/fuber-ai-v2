# Fuber AI 2 - UI Automation helper process (READ side of the pc module).
#
# This file is intentionally ASCII-only: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI, and a
# mangled multi-byte character inside the C# source below would break compilation.
#
# Protocol: one JSON object per line on stdin, one JSON object per line on stdout (UTF-8).
#   request : {"id":1,"op":"windows"}
#   response: {"id":1,"ok":true,"ms":7,...}   or   {"id":1,"ok":false,"error":"..."}
# The process exits when stdin closes (parent gone).
#
# Hard rules enforced HERE (not only by the caller):
#   - the value of a password field (IsPassword) is never queried and never emitted;
#   - this process never sends input, never changes focus; the only acting op is "invoke" (UIA pattern call).
param([int]$OwnerPid = 0)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace Fuber
{
    public static class UiaHelper
    {
        delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);

        [StructLayout(LayoutKind.Sequential)]
        struct RECT { public int L, T, R, B; }

        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lparam);
        [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lparam);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT rect);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder sb, ref uint size);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint msg, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
        [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);

        const int GWL_EXSTYLE = -20;
        const long WS_EX_TOOLWINDOW = 0x80;
        const long WS_EX_APPWINDOW = 0x40000;
        const uint GW_OWNER = 4;
        const int DWMWA_CLOAKED = 14;
        const uint WM_GETOBJECT = 0x003D;
        const uint OBJID_CLIENT = 0xFFFFFFFC;
        const uint SMTO_ABORTIFHUNG = 0x2;

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static int ownerPid;
        static readonly Dictionary<uint, string[]> procCache = new Dictionary<uint, string[]>();
        static readonly Stopwatch procCacheAge = Stopwatch.StartNew();
        static readonly Dictionary<int, AutomationElement> refs = new Dictionary<int, AutomationElement>();
        static int nextRef = 1;
        static CacheRequest cache;

        static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "chrome", "msedge", "firefox", "brave", "opera", "opera_gx", "vivaldi", "chromium", "arc", "browser", "zen", "librewolf", "waterfox", "thorium"
        };
        static readonly HashSet<string> ShellClasses = new HashSet<string> {
            "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland"
        };

        public static void Run(int owner)
        {
            ownerPid = owner;
            var started = Stopwatch.StartNew();
            bool dpi = false;
            try { dpi = SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            if (!dpi) { try { dpi = SetProcessDpiAwareness(2) == 0; } catch { } }
            Json.MaxJsonLength = 16 * 1024 * 1024;
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;
            stdout.NewLine = "\n";

            cache = new CacheRequest();
            cache.Add(AutomationElement.ControlTypeProperty);
            cache.Add(AutomationElement.NameProperty);
            cache.Add(AutomationElement.IsPasswordProperty);
            cache.Add(AutomationElement.IsOffscreenProperty);
            cache.Add(AutomationElement.IsEnabledProperty);
            cache.Add(AutomationElement.ClassNameProperty);
            cache.Add(AutomationElement.AutomationIdProperty);
            cache.Add(AutomationElement.HasKeyboardFocusProperty);
            cache.Add(AutomationElement.BoundingRectangleProperty);
            cache.Add(AutomationElement.HelpTextProperty);
            cache.Add(SelectionItemPattern.IsSelectedProperty);
            cache.Add(TogglePattern.ToggleStateProperty);
            cache.TreeFilter = Automation.ControlViewCondition;
            cache.TreeScope = TreeScope.Element;
            cache.AutomationElementMode = AutomationElementMode.Full;

            bool uia = false;
            try { uia = AutomationElement.RootElement != null; } catch { }

            var hello = new Dictionary<string, object>();
            hello["hello"] = true;
            hello["dpiAware"] = dpi;
            hello["uia"] = uia;
            hello["pid"] = Process.GetCurrentProcess().Id;
            hello["ms"] = started.ElapsedMilliseconds;
            stdout.WriteLine(Json.Serialize(hello));

            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                var watch = Stopwatch.StartNew();
                object id = null;
                Dictionary<string, object> res;
                try
                {
                    var req = Json.Deserialize<Dictionary<string, object>>(line);
                    req.TryGetValue("id", out id);
                    res = Guarded(req);
                    if (!res.ContainsKey("ok")) res["ok"] = true;
                }
                catch (Exception ex)
                {
                    res = new Dictionary<string, object>();
                    res["ok"] = false;
                    res["error"] = ex.GetType().Name + ": " + ex.Message;
                }
                res["id"] = id;
                res["ms"] = watch.ElapsedMilliseconds;
                stdout.WriteLine(Json.Serialize(res));
            }
        }

        // A UIA call into a hung application can block for many seconds (measured: 18 s). Every request therefore
        // runs on its own thread; when it does not return in time the caller gets an error, the thread is abandoned
        // and the window is avoided for a while. Too many abandoned threads -> exit, the parent starts a fresh helper.
        static int generation;
        static int stuck;
        static readonly Dictionary<long, Stopwatch> slowWindows = new Dictionary<long, Stopwatch>();

        static Dictionary<string, object> Guarded(Dictionary<string, object> req)
        {
            int hardMs = Int(req, "hardMs", 2500);
            long hwnd = 0;
            object rawHwnd;
            if (req.TryGetValue("hwnd", out rawHwnd) && rawHwnd != null) { try { hwnd = Convert.ToInt64(rawHwnd); } catch { } }
            Stopwatch since;
            if (hwnd != 0 && slowWindows.TryGetValue(hwnd, out since))
            {
                if (since.ElapsedMilliseconds < 30000) throw new TimeoutException("window not responding");
                slowWindows.Remove(hwnd);
            }
            int mine = Interlocked.Increment(ref generation);
            req["__gen"] = mine;
            Dictionary<string, object> result = null;
            Exception error = null;
            var thread = new Thread(delegate ()
            {
                try
                {
                    wokeNow = 0;
                    result = Dispatch(req);
                    if (wokeNow > 0 && result != null && !result.ContainsKey("woke")) result["woke"] = wokeNow;
                }
                catch (Exception ex) { error = ex; }
            });
            thread.IsBackground = true;
            thread.Start();
            if (!thread.Join(hardMs))
            {
                if (hwnd != 0) slowWindows[hwnd] = Stopwatch.StartNew();
                if (Interlocked.Increment(ref stuck) > 4) Environment.Exit(3);
                throw new TimeoutException("uia call did not return");
            }
            if (error != null) throw error;
            return result;
        }

        static Dictionary<string, object> Dispatch(Dictionary<string, object> req)
        {
            string op = Str(req, "op", "");
            switch (op)
            {
                case "ping": return new Dictionary<string, object>();
                case "windows": return Windows();
                case "read": return Read(req);
                case "focused": return Focused(req);
                case "at": return At(req);
                case "find": return Find(req);
                case "invoke": return Invoke(req);
                case "browsers": return BrowserWindows(req);
                case "document": return Document(req);
                case "survey": return Survey(req);
                case "wake": return Wake(req);
                default: throw new ArgumentException("unknown op: " + op);
            }
        }

        // ---------- request helpers ----------

        static string Str(Dictionary<string, object> req, string key, string fallback)
        {
            object value;
            return req.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
        }

        static int Int(Dictionary<string, object> req, string key, int fallback)
        {
            object value;
            if (!req.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToInt32(value); } catch { return fallback; }
        }

        static bool Bool(Dictionary<string, object> req, string key, bool fallback)
        {
            object value;
            if (!req.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToBoolean(value); } catch { return fallback; }
        }

        static IntPtr Hwnd(Dictionary<string, object> req)
        {
            object value;
            if (!req.TryGetValue("hwnd", out value) || value == null) throw new ArgumentException("hwnd missing");
            IntPtr hwnd = new IntPtr(Convert.ToInt64(value));
            if (!IsWindow(hwnd)) throw new ArgumentException("window gone");
            return hwnd;
        }

        static string Clip(string text, int max)
        {
            if (text == null) return "";
            if (text.Length <= max) return text;
            return text.Substring(0, max);
        }

        // Same folding as packages/shared foldForSearch: Turkish-aware lower case, then ASCII letters.
        static string Fold(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var sb = new StringBuilder(text.Length);
            foreach (char raw in text)
            {
                int code = raw;
                if (code == 'I') code = 0x131;
                else if (code == 0x130) code = 'i';
                else code = char.ToLowerInvariant(raw);
                switch (code)
                {
                    case 0xE7: code = 'c'; break;
                    case 0x11F: code = 'g'; break;
                    case 0x131: code = 'i'; break;
                    case 0xF6: code = 'o'; break;
                    case 0x15F: code = 's'; break;
                    case 0xFC: code = 'u'; break;
                    case 0xE2: code = 'a'; break;
                    case 0xEE: code = 'i'; break;
                    case 0xFB: code = 'u'; break;
                }
                char c = (char)code;
                sb.Append(c);
            }
            return sb.ToString();
        }

        // ---------- windows ----------

        static string WindowText(IntPtr h)
        {
            int length = GetWindowTextLengthW(h);
            if (length <= 0) return "";
            var sb = new StringBuilder(length + 2);
            GetWindowTextW(h, sb, sb.Capacity);
            return sb.ToString();
        }

        static string ClassName(IntPtr h)
        {
            var sb = new StringBuilder(260);
            GetClassNameW(h, sb, sb.Capacity);
            return sb.ToString();
        }

        // [0] full exe path, [1] file description
        static string[] ProcInfo(uint pid)
        {
            if (procCacheAge.ElapsedMilliseconds > 60000 || procCache.Count > 512)
            {
                procCache.Clear();
                procCacheAge.Restart();
            }
            string[] hit;
            if (procCache.TryGetValue(pid, out hit)) return hit;
            string path = "", description = "";
            IntPtr handle = OpenProcess(0x1000, false, pid);
            if (handle != IntPtr.Zero)
            {
                try
                {
                    var sb = new StringBuilder(1024);
                    uint size = 1024;
                    if (QueryFullProcessImageNameW(handle, 0, sb, ref size)) path = sb.ToString(0, (int)size);
                }
                finally { CloseHandle(handle); }
            }
            if (path.Length > 0)
            {
                try { description = FileVersionInfo.GetVersionInfo(path).FileDescription ?? ""; } catch { }
            }
            hit = new string[] { path, description.Trim() };
            procCache[pid] = hit;
            return hit;
        }

        static Dictionary<string, object> DescribeWindow(IntPtr h, IntPtr foreground, int z)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            string cls = ClassName(h);
            uint appPid = pid;
            if (cls == "ApplicationFrameWindow")
            {
                // Store apps live in ApplicationFrameHost; the real app owns the CoreWindow child.
                uint found = 0;
                EnumChildWindows(h, delegate (IntPtr child, IntPtr l)
                {
                    if (ClassName(child) == "Windows.UI.Core.CoreWindow")
                    {
                        uint childPid;
                        GetWindowThreadProcessId(child, out childPid);
                        if (childPid != 0) { found = childPid; return false; }
                    }
                    return true;
                }, IntPtr.Zero);
                if (found != 0) appPid = found;
            }
            string[] info = ProcInfo(appPid);
            string exe = info[0].Length > 0 ? Path.GetFileNameWithoutExtension(info[0]) : "";
            RECT rect;
            GetWindowRect(h, out rect);
            var w = new Dictionary<string, object>();
            w["hwnd"] = h.ToInt64();
            w["title"] = WindowText(h);
            w["exe"] = exe.ToLowerInvariant();
            w["app"] = info[1].Length > 0 ? info[1] : exe;
            w["path"] = info[0];
            w["pid"] = (long)appPid;
            w["minimized"] = IsIconic(h);
            w["maximized"] = IsZoomed(h);
            w["focused"] = h == foreground;
            w["own"] = ownerPid != 0 && (pid == (uint)ownerPid);
            w["className"] = cls;
            w["rect"] = new int[] { rect.L, rect.T, rect.R, rect.B };
            w["z"] = z;
            return w;
        }

        static bool Listable(IntPtr h)
        {
            if (!IsWindowVisible(h)) return false;
            if (GetWindowTextLengthW(h) == 0) return false;
            long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
            if ((ex & WS_EX_TOOLWINDOW) != 0) return false;
            if (GetWindow(h, GW_OWNER) != IntPtr.Zero && (ex & WS_EX_APPWINDOW) == 0) return false;
            int cloaked;
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return false;
            if (ShellClasses.Contains(ClassName(h))) return false;
            return true;
        }

        static List<IntPtr> TopLevel()
        {
            var handles = new List<IntPtr>();
            EnumWindows(delegate (IntPtr h, IntPtr l) { if (Listable(h)) handles.Add(h); return true; }, IntPtr.Zero);
            return handles;
        }

        // Enumerating processes costs ~15 ms; the lock state is re-checked at most every two seconds.
        static bool lockedValue;
        static Stopwatch lockedAge;
        static bool Locked()
        {
            if (lockedAge != null && lockedAge.ElapsedMilliseconds < 2000) return lockedValue;
            try { lockedValue = Process.GetProcessesByName("LogonUI").Length > 0; } catch { lockedValue = false; }
            lockedAge = Stopwatch.StartNew();
            return lockedValue;
        }

        static Dictionary<string, object> Windows()
        {
            IntPtr foreground = GetForegroundWindow();
            var list = new List<object>();
            bool seen = false;
            int z = 0;
            foreach (IntPtr h in TopLevel())
            {
                if (h == foreground) seen = true;
                list.Add(DescribeWindow(h, foreground, z++));
            }
            var res = new Dictionary<string, object>();
            res["windows"] = list;
            res["foreground"] = foreground == IntPtr.Zero ? (object)null : foreground.ToInt64();
            // Lock screen up: Windows blocks screen capture and injected input; say so instead of acting blind.
            res["locked"] = Locked();
            // A dialog or shell surface can hold the foreground without being an alt-tab window.
            res["foregroundListed"] = seen;
            if (!seen && foreground != IntPtr.Zero)
            {
                var extra = DescribeWindow(foreground, foreground, -1);
                extra["shell"] = ShellClasses.Contains(ClassName(foreground));
                res["foregroundWindow"] = extra;
            }
            return res;
        }

        // ---------- tree walk ----------

        class Frame { public AutomationElement El; public int Depth; }
        delegate bool Visit(AutomationElement el, int depth);

        static AutomationElement Root(IntPtr hwnd)
        {
            EnsureAwake(hwnd);
            using (cache.Activate()) { return AutomationElement.FromHandle(hwnd); }
        }

        // ---------- Chromium / Electron / WebView2 ----------
        //
        // Chromium keeps the WEB accessibility tree switched off until an assistive client shows up: a window of
        // Chrome, Edge, Slack, VS Code, WhatsApp (WebView2) then reads as an almost empty shell ("page read" finds
        // nothing, pc_find cannot see the message box). The tree is switched on per browser process when the
        // renderer host child window (class Chrome_RenderWidgetHostHWND) is asked for its accessible object.
        // We ask once per top-level window (and again every two minutes: a restarted app gets a new process),
        // then give the renderer a moment to publish the tree. This sends a window MESSAGE, not input: nothing is
        // typed, clicked or focused.
        static readonly Dictionary<long, Stopwatch> woken = new Dictionary<long, Stopwatch>();
        [ThreadStatic] static int wokeNow;

        static bool IsChromiumHost(string cls)
        {
            return cls.StartsWith("Chrome_RenderWidgetHostHWND", StringComparison.Ordinal);
        }

        static List<IntPtr> WakeChromium(IntPtr hwnd)
        {
            var hosts = new List<IntPtr>();
            if (IsChromiumHost(ClassName(hwnd))) hosts.Add(hwnd);
            EnumChildWindows(hwnd, delegate (IntPtr child, IntPtr l)
            {
                if (IsChromiumHost(ClassName(child))) hosts.Add(child);
                return hosts.Count < 16;
            }, IntPtr.Zero);
            Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71"); // IAccessible
            foreach (IntPtr host in hosts)
            {
                // 1 = Chromium's "screen reader honeypot" object id; OBJID_CLIENT = the classic MSAA root request.
                IntPtr ignored;
                SendMessageTimeoutW(host, WM_GETOBJECT, IntPtr.Zero, new IntPtr(1), SMTO_ABORTIFHUNG, 200, out ignored);
                try
                {
                    object acc;
                    if (AccessibleObjectFromWindow(host, OBJID_CLIENT, ref iid, out acc) == 0 && acc != null) Marshal.ReleaseComObject(acc);
                }
                catch (Exception) { }
                // The UI Automation root request (native UIA provider of newer Chromium).
                try { AutomationElement.FromHandle(host); } catch (Exception) { }
            }
            return hosts;
        }

        // "The page is there": the renderer host exposes a document that already has content. A bare host or an
        // empty document root does not count (measured: the root shows up first, its children a moment later).
        static bool HasPage(IntPtr host)
        {
            AutomationElement el = AutomationElement.FromHandle(host);
            if (el == null) return false;
            AutomationElement doc = el.Current.ControlType == ControlType.Document
                ? el
                : el.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
            return doc != null && doc.FindFirst(TreeScope.Children, Condition.TrueCondition) != null;
        }

        static void EnsureAwake(IntPtr hwnd)
        {
            long key = hwnd.ToInt64();
            Stopwatch since;
            if (woken.TryGetValue(key, out since) && since.ElapsedMilliseconds < 120000) return;
            if (woken.Count > 256) woken.Clear();
            woken[key] = Stopwatch.StartNew();
            List<IntPtr> hosts = null;
            try { hosts = WakeChromium(hwnd); } catch (Exception) { }
            if (hosts == null || hosts.Count == 0) return;
            wokeNow = hosts.Count;
            // The renderer publishes the tree asynchronously (measured on a hidden Electron window: the first read
            // returns the bare shell, the page arrives 120-400 ms later). Wait until a host has content, at most
            // ~700 ms, so the caller's FIRST read already sees the page. A truly empty page costs the full wait once.
            for (int attempt = 0; attempt < 9; attempt++)
            {
                Thread.Sleep(attempt == 0 ? 60 : 80);
                foreach (IntPtr host in hosts)
                {
                    try
                    {
                        if (HasPage(host)) return;
                    }
                    catch (Exception) { }
                }
            }
        }

        static Dictionary<string, object> Wake(Dictionary<string, object> req)
        {
            IntPtr hwnd = Hwnd(req);
            woken.Remove(hwnd.ToInt64());
            wokeNow = 0;
            EnsureAwake(hwnd);
            var res = new Dictionary<string, object>();
            res["hosts"] = wokeNow;
            return res;
        }

        static bool Walk(AutomationElement root, int maxNodes, int budgetMs, Visit visit, out int visited)
        {
            var watch = Stopwatch.StartNew();
            var stack = new Stack<Frame>();
            stack.Push(new Frame { El = root, Depth = 0 });
            visited = 0;
            while (stack.Count > 0)
            {
                if (visited >= maxNodes || watch.ElapsedMilliseconds > budgetMs) return true;
                Frame frame = stack.Pop();
                visited++;
                bool descend;
                try { descend = visit(frame.El, frame.Depth); }
                catch (Exception) { continue; }
                if (!descend) continue;
                AutomationElementCollection kids;
                try
                {
                    using (cache.Activate()) { kids = frame.El.FindAll(TreeScope.Children, Condition.TrueCondition); }
                }
                catch (Exception) { continue; }
                for (int i = kids.Count - 1; i >= 0; i--) stack.Push(new Frame { El = kids[i], Depth = frame.Depth + 1 });
            }
            return false;
        }

        static string Role(ControlType type)
        {
            if (type == null) return "Custom";
            string name = type.ProgrammaticName;
            int dot = name.IndexOf('.');
            return dot >= 0 ? name.Substring(dot + 1) : name;
        }

        static bool IsLeafRole(ControlType t)
        {
            return t == ControlType.Text || t == ControlType.Image || t == ControlType.Separator || t == ControlType.Thumb
                || t == ControlType.Button || t == ControlType.CheckBox || t == ControlType.RadioButton || t == ControlType.Hyperlink
                || t == ControlType.Edit || t == ControlType.ComboBox || t == ControlType.ProgressBar || t == ControlType.Slider
                || t == ControlType.Spinner || t == ControlType.SplitButton || t == ControlType.MenuItem;
        }

        static bool IsSkippedRole(ControlType t)
        {
            return t == ControlType.ScrollBar || t == ControlType.TitleBar || t == ControlType.ToolTip;
        }

        static string TextOf(AutomationElement el, int max)
        {
            try
            {
                object pattern;
                if (el.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
                {
                    return ((TextPattern)pattern).DocumentRange.GetText(max);
                }
            }
            catch (Exception) { }
            return null;
        }

        // Never called for password elements (callers check IsPassword first).
        static string ValueOf(AutomationElement el, int max)
        {
            try
            {
                object value = el.GetCurrentPropertyValue(ValuePattern.ValueProperty, true);
                if (value is string) return Clip((string)value, max);
            }
            catch (Exception) { }
            return null;
        }

        static string Flags(AutomationElement el)
        {
            var info = el.Cached;
            var sb = new StringBuilder();
            if (!info.IsEnabled) sb.Append('x');
            if (info.HasKeyboardFocus) sb.Append('*');
            object selected = el.GetCachedPropertyValue(SelectionItemPattern.IsSelectedProperty, true);
            if (selected is bool && (bool)selected) sb.Append('s');
            object toggle = el.GetCachedPropertyValue(TogglePattern.ToggleStateProperty, true);
            if (toggle is ToggleState && (ToggleState)toggle == ToggleState.On) sb.Append('c');
            return sb.ToString();
        }

        static Dictionary<string, object> Read(Dictionary<string, object> req)
        {
            IntPtr hwnd = Hwnd(req);
            int maxNodes = Int(req, "maxNodes", 600);
            int budgetMs = Int(req, "budgetMs", 450);
            int maxText = Int(req, "maxText", 4000);
            bool offscreen = Bool(req, "offscreen", false);
            var nodes = new List<object>();
            AutomationElement root = Root(hwnd);
            int visited;
            bool truncated = Walk(root, maxNodes, budgetMs, delegate (AutomationElement el, int depth)
            {
                var info = el.Cached;
                ControlType type = info.ControlType;
                if (IsSkippedRole(type)) return false;
                if (depth > 0 && info.IsOffscreen && !offscreen) return false;
                bool password = info.IsPassword;
                var node = new Dictionary<string, object>();
                node["d"] = depth;
                node["r"] = Role(type);
                node["n"] = Clip(info.Name, type == ControlType.Text ? 600 : 300);
                string flags = Flags(el);
                if (flags.Length > 0) node["f"] = flags;
                bool descend = !IsLeafRole(type);
                if (password)
                {
                    node["pw"] = true;
                }
                else if (type == ControlType.Edit || type == ControlType.ComboBox)
                {
                    string value = ValueOf(el, 300);
                    if (!string.IsNullOrEmpty(value)) node["v"] = value;
                }
                else if (type == ControlType.Document)
                {
                    string text = TextOf(el, maxText);
                    if (!string.IsNullOrEmpty(text)) { node["v"] = text; descend = false; }
                }
                nodes.Add(node);
                return descend;
            }, out visited);
            var res = new Dictionary<string, object>();
            res["nodes"] = nodes;
            res["visited"] = visited;
            res["truncated"] = truncated;
            return res;
        }

        // ---------- focused element ----------

        static Dictionary<string, object> Focused(Dictionary<string, object> req)
        {
            int maxText = Int(req, "maxText", 2000);
            IntPtr foreground = GetForegroundWindow();
            var res = new Dictionary<string, object>();
            res["hwnd"] = foreground == IntPtr.Zero ? (object)null : foreground.ToInt64();
            AutomationElement el = AutomationElement.FocusedElement;
            if (el == null) { res["known"] = false; return res; }
            var info = el.Current;
            bool password = info.IsPassword;
            res["known"] = true;
            res["role"] = Role(info.ControlType);
            res["name"] = Clip(info.Name, 200);
            res["className"] = info.ClassName ?? "";
            res["pid"] = info.ProcessId;
            res["password"] = password;
            bool editable = false;
            string value = null;
            if (!password)
            {
                try
                {
                    object pattern;
                    if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                    {
                        var vp = (ValuePattern)pattern;
                        editable = !vp.Current.IsReadOnly;
                        value = Clip(vp.Current.Value, maxText);
                    }
                }
                catch (Exception) { }
                if (value == null)
                {
                    value = TextOf(el, maxText);
                    if (value != null && (info.ControlType == ControlType.Document || info.ControlType == ControlType.Edit)) editable = true;
                }
            }
            res["editable"] = editable;
            res["value"] = value;
            try
            {
                System.Windows.Rect box = info.BoundingRectangle;
                if (!box.IsEmpty && box.Width > 0 && box.Height > 0) res["rect"] = new int[] { (int)box.Left, (int)box.Top, (int)box.Right, (int)box.Bottom };
            }
            catch (Exception) { }
            return res;
        }

        // Element under a screen point: lets a coordinate click get the same safety checks as a click by name.
        static Dictionary<string, object> At(Dictionary<string, object> req)
        {
            var point = new System.Windows.Point(Int(req, "x", 0), Int(req, "y", 0));
            var res = new Dictionary<string, object>();
            AutomationElement el = AutomationElement.FromPoint(point);
            if (el == null) { res["known"] = false; return res; }
            var info = el.Current;
            res["known"] = true;
            res["role"] = Role(info.ControlType);
            res["name"] = Clip(info.Name, 200);
            res["className"] = info.ClassName ?? "";
            res["password"] = info.IsPassword;
            res["enabled"] = info.IsEnabled;
            // The nearest named ancestor tells what an unnamed icon belongs to (a tab's close button, a toolbar).
            try
            {
                AutomationElement parent = TreeWalker.ControlViewWalker.GetParent(el);
                if (parent != null)
                {
                    res["parentRole"] = Role(parent.Current.ControlType);
                    res["parentName"] = Clip(parent.Current.Name, 200);
                }
            }
            catch (Exception) { }
            return res;
        }

        // ---------- find / invoke ----------

        class Hit { public AutomationElement El; public int Score; public string Name; public string Role; }

        static bool Actionable(ControlType t)
        {
            return t == ControlType.Button || t == ControlType.Hyperlink || t == ControlType.MenuItem || t == ControlType.TabItem
                || t == ControlType.ListItem || t == ControlType.CheckBox || t == ControlType.RadioButton || t == ControlType.Edit
                || t == ControlType.ComboBox || t == ControlType.TreeItem || t == ControlType.SplitButton || t == ControlType.DataItem;
        }

        static Dictionary<string, object> Find(Dictionary<string, object> req)
        {
            IntPtr hwnd = Hwnd(req);
            int max = Int(req, "max", 6);
            int maxNodes = Int(req, "maxNodes", 4000);
            int budgetMs = Int(req, "budgetMs", 1500);
            string role = Str(req, "role", "");
            var terms = new List<string>();
            object rawTerms;
            if (req.TryGetValue("terms", out rawTerms) && rawTerms is System.Collections.IEnumerable)
            {
                foreach (object term in (System.Collections.IEnumerable)rawTerms)
                {
                    string folded = Fold(Convert.ToString(term));
                    if (folded.Length > 0) terms.Add(folded);
                }
            }
            // A role alone is a valid query ("the text field of this window"): every visible element of that type matches.
            bool roleOnly = terms.Count == 0;
            if (roleOnly && role.Length == 0) throw new ArgumentException("terms missing");
            string joined = string.Join(" ", terms.ToArray());
            var hits = new List<Hit>();
            int visited;
            bool truncated = Walk(Root(hwnd), maxNodes, budgetMs, delegate (AutomationElement el, int depth)
            {
                var info = el.Cached;
                ControlType type = info.ControlType;
                if (type == ControlType.ScrollBar || type == ControlType.ToolTip) return false;
                bool field = type == ControlType.Edit || type == ControlType.ComboBox;
                string shown = info.Name;
                // Web fields often carry their label as placeholder / help text instead of a name ("Type a message").
                if (string.IsNullOrEmpty(shown) && field) shown = info.HelpText;
                string name = Fold(shown);
                bool all = roleOnly ? !info.IsOffscreen : name.Length > 0;
                if (all && !roleOnly)
                {
                    string hay = field ? name + " " + Fold(info.HelpText) : name;
                    foreach (string term in terms) { if (hay.IndexOf(term, StringComparison.Ordinal) < 0) { all = false; break; } }
                }
                if (all && (role.Length == 0 || string.Equals(Role(type), role, StringComparison.OrdinalIgnoreCase)))
                {
                    int score = roleOnly ? 60 : name == joined ? 100 : name.StartsWith(joined, StringComparison.Ordinal) ? 80 : 60;
                    if (info.HasKeyboardFocus) score += 3;
                    if (Actionable(type)) score += 10;
                    else if (type == ControlType.Text || type == ControlType.Pane || type == ControlType.Group || type == ControlType.Window || type == ControlType.Document) score -= 15;
                    if (!info.IsOffscreen) score += 5;
                    if (info.IsEnabled) score += 5;
                    hits.Add(new Hit { El = el, Score = score, Name = Clip(shown, 200), Role = Role(type) });
                }
                // Buttons and links are matched by their own name; their inner text would only duplicate the hit.
                return !(type == ControlType.Button || type == ControlType.Hyperlink || type == ControlType.Text || type == ControlType.Image
                    || type == ControlType.Edit || type == ControlType.CheckBox || type == ControlType.RadioButton);
            }, out visited);

            hits.Sort(delegate (Hit a, Hit b) { return b.Score.CompareTo(a.Score); });
            if (Int(req, "__gen", 0) != generation) throw new TimeoutException("superseded");
            refs.Clear();
            var list = new List<object>();
            for (int i = 0; i < hits.Count && i < max; i++)
            {
                Hit hit = hits[i];
                var item = new Dictionary<string, object>();
                int id = nextRef++;
                refs[id] = hit.El;
                item["ref"] = id;
                item["role"] = hit.Role;
                item["name"] = hit.Name;
                item["score"] = hit.Score;
                try
                {
                    var info = hit.El.Cached;
                    item["onscreen"] = !info.IsOffscreen;
                    item["enabled"] = info.IsEnabled;
                    item["password"] = info.IsPassword;
                    System.Windows.Rect rect = info.BoundingRectangle;
                    if (!rect.IsEmpty && rect.Width > 0 && rect.Height > 0)
                    {
                        item["rect"] = new int[] { (int)rect.Left, (int)rect.Top, (int)rect.Right, (int)rect.Bottom };
                    }
                    System.Windows.Point point;
                    if (hit.El.TryGetClickablePoint(out point)) item["point"] = new int[] { (int)point.X, (int)point.Y };
                    var patterns = new List<string>();
                    object pattern;
                    if (hit.El.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) patterns.Add("invoke");
                    if (hit.El.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) patterns.Add("select");
                    if (hit.El.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) patterns.Add("toggle");
                    if (hit.El.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) patterns.Add("expand");
                    item["patterns"] = patterns;
                }
                catch (Exception) { item["stale"] = true; }
                list.Add(item);
            }
            var res = new Dictionary<string, object>();
            res["matches"] = list;
            res["total"] = hits.Count;
            res["visited"] = visited;
            res["truncated"] = truncated;
            return res;
        }

        static Dictionary<string, object> Invoke(Dictionary<string, object> req)
        {
            int id = Int(req, "ref", 0);
            AutomationElement el;
            var res = new Dictionary<string, object>();
            if (!refs.TryGetValue(id, out el)) { res["ok"] = false; res["error"] = "stale_ref"; return res; }
            object pattern;
            if (el.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); res["pattern"] = "invoke"; return res; }
            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); res["pattern"] = "select"; return res; }
            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); res["pattern"] = "toggle"; return res; }
            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
            {
                var ec = (ExpandCollapsePattern)pattern;
                if (ec.Current.ExpandCollapseState == ExpandCollapseState.Collapsed) ec.Expand(); else ec.Collapse();
                res["pattern"] = "expand";
                return res;
            }
            res["ok"] = false;
            res["error"] = "no_pattern";
            return res;
        }

        // ---------- survey: what can be acted on in this window ----------
        //
        // A short list of the visible, named controls (fields, buttons, tabs, links, list rows). Every acting tool
        // appends it to its result, so the model can pick its next target without a separate look at the screen.
        // Web documents ARE descended here (unlike "read", which returns the page text instead).
        static Dictionary<string, object> Survey(Dictionary<string, object> req)
        {
            IntPtr hwnd = Hwnd(req);
            int max = Int(req, "max", 40);
            int maxNodes = Int(req, "maxNodes", 1500);
            int budgetMs = Int(req, "budgetMs", 250);
            var items = new List<object>();
            int visited;
            int skipped = 0;
            bool truncated = Walk(Root(hwnd), maxNodes, budgetMs, delegate (AutomationElement el, int depth)
            {
                var info = el.Cached;
                ControlType type = info.ControlType;
                if (IsSkippedRole(type)) return false;
                if (depth > 0 && info.IsOffscreen) return false;
                if (Actionable(type))
                {
                    string name = info.Name;
                    bool field = type == ControlType.Edit || type == ControlType.ComboBox;
                    if (string.IsNullOrWhiteSpace(name) && field) name = info.HelpText;
                    if (!string.IsNullOrWhiteSpace(name) || field)
                    {
                        if (items.Count < max)
                        {
                            var item = new Dictionary<string, object>();
                            item["r"] = Role(type);
                            item["n"] = Clip((name ?? "").Trim(), 80);
                            string flags = Flags(el);
                            if (flags.Length > 0) item["f"] = flags;
                            if (info.IsPassword) item["pw"] = true;
                            items.Add(item);
                        }
                        else skipped++;
                    }
                    // Rows, tabs and tree items are taken whole: their inner texts would only repeat the name.
                    return false;
                }
                return !(type == ControlType.Text || type == ControlType.Image || type == ControlType.Separator || type == ControlType.Thumb
                    || type == ControlType.ProgressBar || type == ControlType.Slider || type == ControlType.Spinner);
            }, out visited);
            var res = new Dictionary<string, object>();
            res["items"] = items;
            res["more"] = skipped;
            res["visited"] = visited;
            res["truncated"] = truncated;
            return res;
        }

        // ---------- browsers ----------

        static bool IsBrowserChrome(ControlType t)
        {
            // Containers of the browser's own UI worth descending into while looking for tabs and the address bar.
            return t == ControlType.Window || t == ControlType.Pane || t == ControlType.ToolBar || t == ControlType.Tab
                || t == ControlType.Group || t == ControlType.Custom;
        }

        static Dictionary<string, object> BrowserInfo(IntPtr hwnd, IntPtr foreground, int z, int budgetMs)
        {
            var w = DescribeWindow(hwnd, foreground, z);
            var tabs = new List<object>();
            string url = null;
            bool hasDocument = false;
            int visited;
            bool truncated = false;
            try
            {
                truncated = Walk(Root(hwnd), 1500, budgetMs, delegate (AutomationElement el, int depth)
                {
                    var info = el.Cached;
                    ControlType type = info.ControlType;
                    if (type == ControlType.Document) { hasDocument = true; return false; }
                    if (type == ControlType.TabItem)
                    {
                        var tab = new Dictionary<string, object>();
                        tab["title"] = Clip(info.Name, 300);
                        object selected = el.GetCachedPropertyValue(SelectionItemPattern.IsSelectedProperty, true);
                        tab["active"] = selected is bool && (bool)selected;
                        tabs.Add(tab);
                        return false;
                    }
                    if (type == ControlType.Edit)
                    {
                        if (url == null && !info.IsPassword)
                        {
                            string cls = info.ClassName ?? "";
                            string autoId = info.AutomationId ?? "";
                            string name = Fold(info.Name);
                            if (cls == "OmniboxViewViews" || autoId == "urlbar-input" || autoId == "view_1022"
                                || name.IndexOf("adres", StringComparison.Ordinal) >= 0 || name.IndexOf("address", StringComparison.Ordinal) >= 0)
                            {
                                url = ValueOf(el, 2000);
                            }
                        }
                        return false;
                    }
                    return IsBrowserChrome(type);
                }, out visited);
            }
            catch (Exception ex)
            {
                w["error"] = ex.GetType().Name;
                visited = 0;
            }
            w["tabs"] = tabs;
            w["url"] = url;
            w["hasDocument"] = hasDocument;
            w["visited"] = visited;
            w["truncated"] = truncated;
            return w;
        }

        // One hung browser window must not cost the answer for the others.
        static Dictionary<string, object> TimedBrowserInfo(IntPtr hwnd, IntPtr foreground, int z, int budgetMs)
        {
            Dictionary<string, object> result = null;
            var thread = new Thread(delegate ()
            {
                try { result = BrowserInfo(hwnd, foreground, z, budgetMs); }
                catch (Exception) { }
            });
            thread.IsBackground = true;
            thread.Start();
            if (thread.Join(budgetMs + 600) && result != null) return result;
            var w = DescribeWindow(hwnd, foreground, z);
            w["tabs"] = new List<object>();
            w["url"] = null;
            w["hasDocument"] = false;
            w["error"] = "timeout";
            return w;
        }

        static Dictionary<string, object> BrowserWindows(Dictionary<string, object> req)
        {
            int budgetMs = Int(req, "budgetMs", 700);
            IntPtr foreground = GetForegroundWindow();
            var list = new List<object>();
            int z = 0;
            foreach (IntPtr h in TopLevel())
            {
                int index = z++;
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                string path = ProcInfo(pid)[0];
                if (path.Length == 0 || !Browsers.Contains(Path.GetFileNameWithoutExtension(path))) continue;
                list.Add(TimedBrowserInfo(h, foreground, index, budgetMs));
            }
            var res = new Dictionary<string, object>();
            res["browsers"] = list;
            return res;
        }

        static Dictionary<string, object> Document(Dictionary<string, object> req)
        {
            IntPtr hwnd = Hwnd(req);
            int maxChars = Int(req, "maxChars", 8000);
            int budgetMs = Int(req, "budgetMs", 1200);
            var watch = Stopwatch.StartNew();
            AutomationElement best = null;
            double bestArea = -1;
            int visited;
            Walk(Root(hwnd), 2000, budgetMs / 2, delegate (AutomationElement el, int depth)
            {
                var info = el.Cached;
                ControlType type = info.ControlType;
                if (type == ControlType.Document)
                {
                    if (!info.IsOffscreen)
                    {
                        System.Windows.Rect rect = info.BoundingRectangle;
                        double area = rect.IsEmpty ? 0 : rect.Width * rect.Height;
                        if (area > bestArea) { bestArea = area; best = el; }
                    }
                    return false;
                }
                if (type == ControlType.TabItem || type == ControlType.Edit) return false;
                return IsBrowserChrome(type);
            }, out visited);

            var res = new Dictionary<string, object>();
            res["found"] = best != null;
            res["method"] = "none";
            res["text"] = "";
            res["truncated"] = false;
            if (best == null) return res;

            string text = TextOf(best, maxChars + 1);
            if (!string.IsNullOrWhiteSpace(text))
            {
                res["method"] = "text";
                res["truncated"] = text.Length > maxChars;
                res["text"] = Clip(text, maxChars);
                return res;
            }

            // No text pattern: collect the names of visible elements in reading order (never values).
            var sb = new StringBuilder();
            string last = null;
            int remaining = budgetMs - (int)watch.ElapsedMilliseconds;
            int docVisited;
            bool truncated = Walk(best, 3000, remaining < 150 ? 150 : remaining, delegate (AutomationElement el, int depth)
            {
                var info = el.Cached;
                ControlType type = info.ControlType;
                if (IsSkippedRole(type)) return false;
                if (depth > 0 && info.IsOffscreen) return false;
                string name = info.Name;
                if (!string.IsNullOrWhiteSpace(name) && depth > 0 && name != last && sb.Length <= maxChars)
                {
                    sb.Append(name.Trim());
                    sb.Append('\n');
                    last = name;
                }
                if (sb.Length > maxChars) return false;
                return !IsLeafRole(type);
            }, out docVisited);
            if (sb.Length > 0)
            {
                res["method"] = "tree";
                res["truncated"] = truncated || sb.Length > maxChars;
                res["text"] = Clip(sb.ToString(), maxChars);
            }
            res["visited"] = docVisited;
            return res;
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Web.Extensions') -ErrorAction Stop
[Fuber.UiaHelper]::Run($OwnerPid)
