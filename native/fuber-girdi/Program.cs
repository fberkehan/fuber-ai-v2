// Fuber girdi yardımcısı — ekran görüntüsü + fare + klavye + pencereler (Windows, .NET Framework 4, C# 5).
// Ana süreç bu programı bir kez başlatır ve stdin'e satır satır JSON komut yazar; her komuta tek satır JSON yanıt
// döner. Koordinatlar FİZİKSEL pikseldir (süreç Per-Monitor-V2 DPI farkındalıklı), ölçekli ekranda kayma olmaz.
// Derleme: native/derle.mjs (csc.exe /target:winexe değil, konsol: stdin/stdout gerekir).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace FuberGirdi
{
    internal static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern short VkKeyScanW(char ch);
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
        // Tam ekran bilgisi burada DEĞİL: olay güdümlü native/fuber-olay (0.14 T22, Ruling R1) — bu yardımcı yalnız bilgisayar
        // kontrolünde başlar.

        delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
        [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint MOUSEEVENTF_LEFTDOWN = 0x02, MOUSEEVENTF_LEFTUP = 0x04, MOUSEEVENTF_RIGHTDOWN = 0x08, MOUSEEVENTF_RIGHTUP = 0x10;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x20, MOUSEEVENTF_MIDDLEUP = 0x40, MOUSEEVENTF_WHEEL = 0x800, MOUSEEVENTF_HWHEEL = 0x1000;
        const uint KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4, KEYEVENTF_EXTENDEDKEY = 0x1;

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        [STAThread]
        static void Main()
        {
            try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { try { SetProcessDPIAware(); } catch { } }
            Console.InputEncoding = Encoding.UTF8;
            var cikis = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            cikis.AutoFlush = true;
            string satir;
            while ((satir = Console.ReadLine()) != null)
            {
                if (satir.Trim().Length == 0) continue;
                object yanit;
                try { yanit = Isle(Json.Deserialize<Dictionary<string, object>>(satir)); }
                catch (Exception e) { yanit = new Dictionary<string, object> { { "ok", false }, { "hata", e.Message } }; }
                cikis.WriteLine(Json.Serialize(yanit));
            }
        }

        static int Tam(Dictionary<string, object> k, string ad, int varsayilan)
        {
            object v; return k.TryGetValue(ad, out v) && v != null ? Convert.ToInt32(v) : varsayilan;
        }
        static string Metin(Dictionary<string, object> k, string ad)
        {
            object v; return k.TryGetValue(ad, out v) && v != null ? Convert.ToString(v) : "";
        }
        static Dictionary<string, object> Tamam() { return new Dictionary<string, object> { { "ok", true } }; }

        // Oturum kilitliyken (kilit ekranı = LogonUI) Windows ekran yakalamayı ve girdi enjeksiyonunu bilerek engeller:
        // görüntü siyah gelir, tıklamalar hiçbir yere gitmez. Bunu açıkça bildir (model tahmin yürütmesin).
        static bool Kilitli() { return Process.GetProcessesByName("LogonUI").Length > 0; }

        // Kullanıcı devraldı mı? Windows'un son girdi zamanı (GetLastInputInfo) bizim son enjeksiyonumuzdan (refTick)
        // sonraysa o girdi kullanıcınındır. Her enjeksiyondan sonra refTick şimdiye çekilir; ana süreç "referans" ile sıfırlar.
        static uint refTick = (uint)Environment.TickCount;
        static uint SonGirdi() { var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)); GetLastInputInfo(ref l); return l.dwTime; }
        static bool Enjeksiyon(string komut) { return komut == "tikla" || komut == "surukle" || komut == "kaydir" || komut == "yaz" || komut == "tus" || komut == "tasi" || komut == "yolla" || komut == "odakla"; }

        static object Isle(Dictionary<string, object> k)
        {
            string komut = Metin(k, "k");
            if (komut == "kilit") return new Dictionary<string, object> { { "ok", true }, { "kilitli", Kilitli() } };
            if (Enjeksiyon(komut) && Kilitli())
                throw new Exception("Windows oturumu kilitli: fare ve klavye kullanılamaz (kullanıcı kilidi açmalı).");
            try { return Calistir(komut, k); }
            finally { if (Enjeksiyon(komut)) refTick = (uint)Environment.TickCount; }
        }

        static object Calistir(string komut, Dictionary<string, object> k)
        {
            switch (komut)
            {
                case "referans": refTick = (uint)Environment.TickCount; return Tamam();
                case "kullanici":
                {
                    uint son = SonGirdi();
                    return new Dictionary<string, object> { { "ok", true }, { "degdi", unchecked((int)(son - refTick)) > 150 }, { "ms", unchecked((uint)Environment.TickCount - son) } };
                }
                case "ekran": return Ekran(Tam(k, "ekran", -1), Tam(k, "en", 1366));
                case "ekranlar":
                {
                    var l = new List<object>();
                    foreach (var s in Screen.AllScreens) l.Add(new Dictionary<string, object> { { "x", s.Bounds.X }, { "y", s.Bounds.Y }, { "w", s.Bounds.Width }, { "h", s.Bounds.Height }, { "birincil", s.Primary } });
                    return new Dictionary<string, object> { { "ok", true }, { "ekranlar", l } };
                }
                case "imlec": { POINT p; GetCursorPos(out p); return new Dictionary<string, object> { { "ok", true }, { "x", p.X }, { "y", p.Y } }; }
                case "tasi": SetCursorPos(Tam(k, "x", 0), Tam(k, "y", 0)); return Tamam();
                case "yolla": Yolla(Tam(k, "x", 0), Tam(k, "y", 0), Tam(k, "sure", 320)); return Tamam();
                case "tikla": Tikla(Tam(k, "x", 0), Tam(k, "y", 0), Metin(k, "d"), Tam(k, "adet", 1)); return Tamam();
                case "surukle": Surukle(Tam(k, "x1", 0), Tam(k, "y1", 0), Tam(k, "x2", 0), Tam(k, "y2", 0)); return Tamam();
                case "kaydir": Kaydir(Tam(k, "x", -1), Tam(k, "y", -1), Tam(k, "dy", 0), Tam(k, "dx", 0)); return Tamam();
                case "yaz": Yaz(Metin(k, "metin")); return Tamam();
                case "tus": Tus(Metin(k, "kombin")); return Tamam();
                case "pencereler": return Pencereler();
                case "odakla": return Odakla(Metin(k, "baslik"));
                default: throw new Exception("Bilinmeyen komut: " + komut);
            }
        }

        static object Ekran(int ekranNo, int hedefEn)
        {
            Rectangle b;
            if (ekranNo >= 0 && ekranNo < Screen.AllScreens.Length) b = Screen.AllScreens[ekranNo].Bounds;
            else { POINT p; GetCursorPos(out p); b = Screen.FromPoint(new Point(p.X, p.Y)).Bounds; }
            using (var bmp = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(b.X, b.Y, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
                int gw = Math.Min(hedefEn, b.Width);
                int gh = (int)Math.Round(b.Height * (gw / (double)b.Width));
                using (var kucuk = new Bitmap(gw, gh, PixelFormat.Format24bppRgb))
                {
                    using (var g2 = Graphics.FromImage(kucuk)) { g2.InterpolationMode = InterpolationMode.HighQualityBicubic; g2.DrawImage(bmp, 0, 0, gw, gh); }
                    // İmleç konumunu küçük bir halka ile işaretle (model nerede olduğunu görsün).
                    POINT im; GetCursorPos(out im);
                    if (b.Contains(im.X, im.Y))
                    {
                        float ix = (im.X - b.X) * (gw / (float)b.Width), iy = (im.Y - b.Y) * (gh / (float)b.Height);
                        using (var g3 = Graphics.FromImage(kucuk)) using (var kalem = new Pen(Color.FromArgb(220, 255, 64, 64), 2)) g3.DrawEllipse(kalem, ix - 6, iy - 6, 12, 12);
                    }
                    using (var ms = new MemoryStream())
                    {
                        var kod = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
                        var p = new EncoderParameters(1); p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
                        kucuk.Save(ms, kod, p);
                        // Neredeyse tamamen siyah mı? (kilit, uyuyan ekran ya da yakalanamayan donanım hızlandırmalı içerik)
                        long toplam = 0; int adet = 0;
                        for (int yy = 0; yy < gh; yy += Math.Max(1, gh / 24)) for (int xx = 0; xx < gw; xx += Math.Max(1, gw / 40)) { var c = kucuk.GetPixel(xx, yy); toplam += c.R + c.G + c.B; adet++; }
                        bool karanlik = adet > 0 && toplam / (3.0 * adet) < 3.0;
                        return new Dictionary<string, object> { { "ok", true }, { "jpeg", Convert.ToBase64String(ms.ToArray()) }, { "x0", b.X }, { "y0", b.Y }, { "w", b.Width }, { "h", b.Height }, { "gw", gw }, { "gh", gh }, { "kilitli", Kilitli() }, { "karanlik", karanlik } };
                    }
                }
            }
        }

        static void Fare(uint bayrak, uint veri)
        {
            var i = new INPUT { type = INPUT_MOUSE };
            i.u.mi = new MOUSEINPUT { dwFlags = bayrak, mouseData = veri };
            SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
        }

        // Gerçek imleci hedefe hafif kavisle ve kolaylaştırmayla götürür (ışınlanmaz). Fuber imleci katmanı
        // (src/renderer/imlec.ts) AYNI eğriyi çizer: kontrol noktası orta nokta + dik yönde %12 kayma, ease-in-out-cubic.
        static void Yolla(int x, int y, int sure)
        {
            POINT p; GetCursorPos(out p);
            double dx = x - p.X, dy = y - p.Y;
            double kx = p.X + dx * 0.5 - dy * 0.12, ky = p.Y + dy * 0.5 + dx * 0.12;
            var saat = Stopwatch.StartNew();
            sure = Math.Max(1, Math.Min(sure, 2000));
            while (true)
            {
                double t = Math.Min(1.0, saat.ElapsedMilliseconds / (double)sure);
                double e = t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2;
                double bx = (1 - e) * (1 - e) * p.X + 2 * (1 - e) * e * kx + e * e * x;
                double by = (1 - e) * (1 - e) * p.Y + 2 * (1 - e) * e * ky + e * e * y;
                SetCursorPos((int)Math.Round(bx), (int)Math.Round(by));
                if (t >= 1) break;
                System.Threading.Thread.Sleep(8);
            }
            SetCursorPos(x, y);
        }

        static void Tikla(int x, int y, string dugme, int adet)
        {
            SetCursorPos(x, y);
            System.Threading.Thread.Sleep(40);
            uint asagi = MOUSEEVENTF_LEFTDOWN, yukari = MOUSEEVENTF_LEFTUP;
            if (dugme == "sag") { asagi = MOUSEEVENTF_RIGHTDOWN; yukari = MOUSEEVENTF_RIGHTUP; }
            else if (dugme == "orta") { asagi = MOUSEEVENTF_MIDDLEDOWN; yukari = MOUSEEVENTF_MIDDLEUP; }
            for (int i = 0; i < Math.Max(1, Math.Min(adet, 3)); i++) { Fare(asagi, 0); Fare(yukari, 0); System.Threading.Thread.Sleep(60); }
        }

        static void Surukle(int x1, int y1, int x2, int y2)
        {
            SetCursorPos(x1, y1); System.Threading.Thread.Sleep(60);
            Fare(MOUSEEVENTF_LEFTDOWN, 0); System.Threading.Thread.Sleep(80);
            for (int i = 1; i <= 12; i++) { SetCursorPos(x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12); System.Threading.Thread.Sleep(15); }
            Fare(MOUSEEVENTF_LEFTUP, 0);
        }

        static void Kaydir(int x, int y, int dy, int dx)
        {
            if (x >= 0 && y >= 0) { SetCursorPos(x, y); System.Threading.Thread.Sleep(30); }
            if (dy != 0) Fare(MOUSEEVENTF_WHEEL, unchecked((uint)(dy * 120)));
            if (dx != 0) Fare(MOUSEEVENTF_HWHEEL, unchecked((uint)(dx * 120)));
        }

        static void Yaz(string metin)
        {
            foreach (char ch in metin)
            {
                if (ch == '\n') { TusBas(0x0D); continue; }
                if (ch == '\t') { TusBas(0x09); continue; }
                var asagi = new INPUT { type = INPUT_KEYBOARD }; asagi.u.ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE };
                var yukari = new INPUT { type = INPUT_KEYBOARD }; yukari.u.ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP };
                SendInput(2, new[] { asagi, yukari }, Marshal.SizeOf(typeof(INPUT)));
                System.Threading.Thread.Sleep(6);
            }
        }

        static void Tusa(ushort vk, bool yukari)
        {
            var i = new INPUT { type = INPUT_KEYBOARD };
            uint b = yukari ? KEYEVENTF_KEYUP : 0;
            if (vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2D || vk == 0x2E || vk == 0x24 || vk == 0x23 || vk == 0x21 || vk == 0x22 || vk == 0x5B) b |= KEYEVENTF_EXTENDEDKEY;
            i.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = b };
            SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
        }
        static void TusBas(ushort vk) { Tusa(vk, false); Tusa(vk, true); }

        static readonly Dictionary<string, ushort> Adlar = new Dictionary<string, ushort>
        {
            { "ctrl", 0x11 }, { "control", 0x11 }, { "shift", 0x10 }, { "alt", 0x12 }, { "win", 0x5B }, { "super", 0x5B }, { "cmd", 0x5B },
            { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "esc", 0x1B }, { "escape", 0x1B }, { "space", 0x20 }, { "bosluk", 0x20 },
            { "backspace", 0x08 }, { "delete", 0x2E }, { "del", 0x2E }, { "insert", 0x2D }, { "home", 0x24 }, { "end", 0x23 },
            { "pageup", 0x21 }, { "pagedown", 0x22 }, { "left", 0x25 }, { "up", 0x26 }, { "right", 0x27 }, { "down", 0x28 },
            { "sol", 0x25 }, { "yukari", 0x26 }, { "sag", 0x27 }, { "asagi", 0x28 }, { "printscreen", 0x2C }, { "capslock", 0x14 }
        };

        static void Tus(string kombin)
        {
            var parcalar = kombin.ToLowerInvariant().Replace(" ", "").Split('+');
            var vkler = new List<ushort>();
            foreach (var p in parcalar)
            {
                if (p.Length == 0) continue;
                ushort vk;
                if (Adlar.TryGetValue(p, out vk)) { vkler.Add(vk); continue; }
                if (p.Length >= 2 && p[0] == 'f') { int n; if (int.TryParse(p.Substring(1), out n) && n >= 1 && n <= 24) { vkler.Add((ushort)(0x70 + n - 1)); continue; } }
                if (p.Length == 1) { short s = VkKeyScanW(p[0]); if (s != -1) { vkler.Add((ushort)(s & 0xFF)); continue; } }
                throw new Exception("Bilinmeyen tuş: " + p);
            }
            foreach (var v in vkler) { Tusa(v, false); System.Threading.Thread.Sleep(20); }
            for (int i = vkler.Count - 1; i >= 0; i--) { Tusa(vkler[i], true); System.Threading.Thread.Sleep(20); }
        }

        static object Pencereler()
        {
            var l = new List<object>();
            EnumWindows((h, _) =>
            {
                if (!IsWindowVisible(h)) return true;
                int n = GetWindowTextLength(h); if (n == 0) return true;
                var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
                RECT r; GetWindowRect(h, out r);
                if (r.Right - r.Left < 80 || r.Bottom - r.Top < 60) return true;
                uint pid; GetWindowThreadProcessId(h, out pid);
                string surec = ""; try { surec = Process.GetProcessById((int)pid).ProcessName; } catch { }
                l.Add(new Dictionary<string, object> { { "baslik", sb.ToString() }, { "surec", surec }, { "x", r.Left }, { "y", r.Top }, { "w", r.Right - r.Left }, { "h", r.Bottom - r.Top }, { "kucuk", IsIconic(h) }, { "on", h == GetForegroundWindow() } });
                return true;
            }, IntPtr.Zero);
            return new Dictionary<string, object> { { "ok", true }, { "pencereler", l } };
        }

        static object Odakla(string baslik)
        {
            IntPtr bulunan = IntPtr.Zero; string ad = "";
            string aranan = baslik.ToLowerInvariant();
            EnumWindows((h, _) =>
            {
                if (!IsWindowVisible(h)) return true;
                int n = GetWindowTextLength(h); if (n == 0) return true;
                var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
                uint pid; GetWindowThreadProcessId(h, out pid);
                string surec = ""; try { surec = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
                if (sb.ToString().ToLowerInvariant().Contains(aranan) || surec == aranan) { bulunan = h; ad = sb.ToString(); return false; }
                return true;
            }, IntPtr.Zero);
            if (bulunan == IntPtr.Zero) return new Dictionary<string, object> { { "ok", false }, { "hata", "Pencere bulunamadı: " + baslik } };
            if (IsIconic(bulunan)) ShowWindow(bulunan, 9);
            uint p0; uint onIplik = GetWindowThreadProcessId(GetForegroundWindow(), out p0);
            uint bu = GetCurrentThreadId();
            AttachThreadInput(bu, onIplik, true);
            SetForegroundWindow(bulunan);
            AttachThreadInput(bu, onIplik, false);
            return new Dictionary<string, object> { { "ok", true }, { "baslik", ad } };
        }
    }
}
