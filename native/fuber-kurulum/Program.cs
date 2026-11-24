// Fuber AI kurulum başlatıcısı (Görev 17, karar K8) — Windows, .NET Framework 4, C# 5; native/derle.mjs → kurulumDerle ile derlenir.
// Varsayılan NSIS sihirbazı (klasör seç, İleri, İleri…) yerine markalı küçük bir pencere: Hoş geldin → Kuruluyor → Hazır.
// İçine gömülü NSIS paketi ("paket.exe" kaynağı: electron-builder çıktısı, tek tık, kullanıcıya özel) geçici klasöre akışla çıkarılır,
// `/S /D=<hedef>` ile sessiz kurulur; bitince "Fuber AI.exe" açılır ve pencere kapanır. Hedef: NSIS'in kayıtlı kurulum yeri
// (yükseltme aynı yerin üstüne kurar; %APPDATA%\Fuber AI verisi korunur), yoksa kullanıcının Programlar klasörü\Fuber AI.
// Kipler:
//   (bağımsız değişkensiz)                     gerçek kurulum
//   --onizleme <klasör> [--olcek 1.5]          HİÇBİR ŞEY KURMADAN her ekranı (hata ekranları dahil) DrawToBitmap ile PNG'ye çizer,
//                                              denetim.json (her yazının boyutu/rengi/zemini, düğme boyları) + temas.png yazar, çıkar
//   --kuru <sahte-paket.exe> <fuber-sahte-….exe> [--hedef <klasör>] [--boyut <bayt>] [--otomatik] [--gizli] [--rapor <json>]
//          [--gunluk <dosya>] [--sahte windows=<derleme>,yonetici=ayni|farkli,makine]
//                                              gömülü paket yerine verilen sahte paketi çalıştırır ve sahte uygulamayı açar (test).
//                                              Sahte uygulamanın adı "fuber-sahte-" ile başlamalı; açık uygulama denetimi yalnız o adla ve
//                                              o klasörde çalışan süreçlere bakar — gerçek Fuber AI'ye ya da başka programa dokunmaz.
// GÜVENLİK: içinde paket olan (dağıtılan) başlatıcı --kuru/--otomatik/--gizli/--rapor/--gunluk/--sahte/--hedef/--boyut'u REDDEDER (64);
// bunlar yalnız paketsiz geliştirme derlemesinde çalışır. Günlük yalnız varsayılan yolunda (%TEMP%\Fuber AI Kurulum.log) döndürülür.
// Çıkış kodu: 0 kuruldu ve açıldı, 1 kullanıcı vazgeçti, 2 kurulum hatası, 3 kuruldu ama açılamadı, 64 hatalı bağımsız değişken.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// İndirilenler klasörüne bırakılmış sahte bir DLL (ör. dwmapi.dll) yüklenmesin: P/Invoke yalnız System32'den.
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

namespace FuberKurulum
{
    internal sealed class Secenekler
    {
        public string Onizleme, SahtePaket, SahteUygulama, Hedef, Rapor, GunlukYolu, Sahte, Hata;
        public float Olcek;
        public long Boyut = -1;
        public bool Kuru, Otomatik, Gizli;
        // --sahte (yalnız kuru): Windows derlemesi, yönetici olarak açılmış (aynı/farklı hesap), tüm kullanıcılara kurulu eski sürüm.
        public int SahteDerleme;
        public string SahteYonetici;
        public bool SahteMakine;

        /// <summary>Paketli (dağıtılan) başlatıcıda yasak olan, yalnız test için var olan bağımsız değişkenler verilmiş mi.</summary>
        public bool TestBayragiVar
        {
            get { return Kuru || Otomatik || Gizli || Rapor != null || GunlukYolu != null || Sahte != null || Hedef != null || Boyut >= 0; }
        }

        public static Secenekler Oku(string[] a)
        {
            var s = new Secenekler();
            try
            {
                for (int i = 0; i < a.Length; i++)
                {
                    switch (a[i])
                    {
                        case "--onizleme": s.Onizleme = Path.GetFullPath(Deger(a, ref i)); break;
                        case "--olcek": s.Olcek = float.Parse(Deger(a, ref i), CultureInfo.InvariantCulture); break;
                        case "--kuru":
                            s.Kuru = true;
                            s.SahtePaket = Path.GetFullPath(Deger(a, ref i));
                            s.SahteUygulama = Path.GetFullPath(Deger(a, ref i));
                            break;
                        case "--hedef": s.Hedef = Deger(a, ref i); break;
                        case "--boyut": s.Boyut = long.Parse(Deger(a, ref i), CultureInfo.InvariantCulture); break;
                        case "--otomatik": s.Otomatik = true; break;
                        case "--gizli": s.Gizli = true; break;
                        case "--rapor": s.Rapor = Path.GetFullPath(Deger(a, ref i)); break;
                        case "--gunluk": s.GunlukYolu = Path.GetFullPath(Deger(a, ref i)); break;
                        case "--sahte": s.Sahte = Deger(a, ref i); break;
                        default: throw new ArgumentException("bilinmeyen bağımsız değişken: " + a[i]);
                    }
                }
                if (!s.Kuru && s.TestBayragiVar)
                    throw new ArgumentException("--otomatik/--gizli/--hedef/--boyut/--rapor/--gunluk/--sahte yalnız --kuru ile");
                if (s.Olcek > 0 && s.Onizleme == null) throw new ArgumentException("--olcek yalnız --onizleme ile");
                if (s.Kuru && s.Onizleme != null) throw new ArgumentException("--kuru ve --onizleme birlikte kullanılmaz");
                if (s.Kuru && !File.Exists(s.SahtePaket)) throw new ArgumentException("sahte paket yok: " + s.SahtePaket);
                if (s.Kuru && !File.Exists(s.SahteUygulama)) throw new ArgumentException("sahte uygulama yok: " + s.SahteUygulama);
                // Kuru kip yalnız bu öneki taşıyan süreçleri kapatabilir (ör. WINWORD.EXE verilip Word kapatılamasın).
                if (s.Kuru && !Path.GetFileName(s.SahteUygulama).StartsWith("fuber-sahte-", StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("--kuru: sahte uygulamanın adı fuber-sahte- ile başlamalı");
                if (s.Sahte != null)
                {
                    foreach (string p in s.Sahte.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        if (p.StartsWith("windows=")) s.SahteDerleme = int.Parse(p.Substring(8), CultureInfo.InvariantCulture);
                        else if (p == "yonetici=ayni" || p == "yonetici=farkli") s.SahteYonetici = p.Substring(9);
                        else if (p == "makine") s.SahteMakine = true;
                        else throw new ArgumentException("--sahte: bilinmeyen öğe " + p);
                    }
                }
            }
            catch (Exception e) { s.Hata = e.Message; }
            return s;
        }

        static string Deger(string[] a, ref int i)
        {
            if (i + 1 >= a.Length) throw new ArgumentException(a[i] + " bir değer bekliyor");
            return a[++i];
        }
    }

    internal static class Json
    {
        public static string Metin(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        public static string Dizi(IEnumerable<string> l)
        {
            var sb = new StringBuilder("[");
            bool ilk = true;
            foreach (string s in l) { if (!ilk) sb.Append(','); sb.Append(Metin(s)); ilk = false; }
            return sb.Append(']').ToString();
        }

        public static string Renk(Color c) { return "[" + c.R + "," + c.G + "," + c.B + "]"; }

        public static string Sayi(double d) { return d.ToString("0.###", CultureInfo.InvariantCulture); }
    }

    internal static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string sinif, string baslik);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int komut);
        [DllImport("kernel32.dll")] static extern bool SetDefaultDllDirectories(uint bayrak);
        const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;

        [STAThread]
        static int Main(string[] args)
        {
            // Önce: sonradan yüklenen yerel DLL'ler yalnız System32'den (indirilen klasöre bırakılmış DLL ele geçiremesin).
            try { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32); } catch { }
            Secenekler s = Secenekler.Oku(args);
            if (s.Hata != null)
            {
                Console.Error.WriteLine("fuber-kurulum: " + s.Hata);
                return 64;
            }
            Bilgi bilgi = Bilgi.Oku();
            if (bilgi.PaketVar && s.TestBayragiVar)
            {
                // Dağıtılan kurulum test bayraklarıyla dosya silemez/ezemez, süreç kapatamaz.
                Console.Error.WriteLine("fuber-kurulum: test bağımsız değişkenleri yalnız geliştirme derlemesinde");
                return 64;
            }
            DpiFarkindaligi();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (s.Onizleme != null) return Onizleme.Calistir(s);

            Mutex tek = null;
            if (!s.Kuru)
            {
                bool yeni;
                tek = new Mutex(true, "Local\\FuberAIKurulum", out yeni);
                if (!yeni)
                {
                    IntPtr h = FindWindow(null, "Fuber AI Kurulum");
                    if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); }
                    tek.Dispose();
                    return 1;
                }
            }
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            try
            {
                using (var p = new Pencere(s, bilgi))
                {
                    Application.ThreadException += delegate(object o, ThreadExceptionEventArgs e)
                    {
                        Gunluk.Ac(s.GunlukYolu).Yaz("arayüz hatası: " + e.Exception);
                    };
                    Application.Run(p);
                    return p.CikisKodu;
                }
            }
            finally
            {
                if (tek != null) { tek.ReleaseMutex(); tek.Dispose(); }
            }
        }

        static void DpiFarkindaligi()
        {
            // Bildirim (manifest) zaten Per-Monitor V2 ister; bu yalnız yedek.
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
            catch (EntryPointNotFoundException) { }
            try { SetProcessDPIAware(); } catch { }
        }
    }

    /// <summary>--onizleme: her ekranı kurmadan PNG'ye çizer; okunurluk denetimi için yazıların zeminini örnekler.</summary>
    internal static class Onizleme
    {
        sealed class Sahne
        {
            public string Ad, Etiket;
            public Ekran Ekran;
            public double Ilerleme, Zaman = 1.2;
            public int Asama;
            public HataBilgisi Hata;
            public bool Odak, Yukseltme;
        }

        static List<Sahne> Sahneler()
        {
            string gunluk = "%TEMP%\\Fuber AI Kurulum.log";
            return new List<Sahne>
            {
                new Sahne { Ad = "1-hos-geldin", Etiket = "1 · Hoş geldin", Ekran = Ekran.HosGeldin },
                new Sahne { Ad = "2-hos-geldin-klavye", Etiket = "1b · Hoş geldin (klavye odağı)", Ekran = Ekran.HosGeldin, Odak = true },
                new Sahne { Ad = "3-uygulama-acik", Etiket = "Fuber AI açıkken", Ekran = Ekran.UygulamaAcik },
                new Sahne { Ad = "4-kapatiliyor", Etiket = "Kapatılıyor", Ekran = Ekran.Kapatiliyor, Zaman = 0.55 },
                new Sahne { Ad = "5-kuruluyor", Etiket = "2 · Kuruluyor (%42)", Ekran = Ekran.Kuruluyor, Ilerleme = 0.42, Asama = 2, Zaman = 1.1 },
                new Sahne { Ad = "6-kuruluyor-yukseltme", Etiket = "2b · Yükseltme (%9)", Ekran = Ekran.Kuruluyor, Ilerleme = 0.09, Asama = 1, Zaman = 0.4, Yukseltme = true },
                new Sahne { Ad = "7-hazir", Etiket = "3 · Hazır", Ekran = Ekran.Hazir, Ilerleme = 1, Zaman = 0.8 },
                new Sahne { Ad = "8-hata", Etiket = "Hata · NSIS kodu 2", Ekran = Ekran.Hata, Hata = HataBilgisi.Nsis(2, gunluk) },
                new Sahne { Ad = "9-hata-disk", Etiket = "Hata · boş alan", Ekran = Ekran.Hata, Hata = HataBilgisi.Disk("C:", 1288490188L, 327155712L) },
                new Sahne { Ad = "10-hata-acilamadi", Etiket = "Kuruldu ama açılamadı", Ekran = Ekran.Hata, Hata = HataBilgisi.Acilamadi("Sistem belirtilen dosyayı bulamıyor") },
                new Sahne { Ad = "11-hata-windows", Etiket = "Hata · eski Windows", Ekran = Ekran.Hata, Hata = HataBilgisi.EskiWindows("10 (derleme 19041)") },
                new Sahne { Ad = "12-hata-baslatilamadi", Etiket = "Hata · paket başlatılamadı (virüs koruması)", Ekran = Ekran.Hata,
                    Hata = HataBilgisi.Baslatilamadi("Erişim engellendi (5)", gunluk) },
                new Sahne { Ad = "13-hata-surum", Etiket = "Hata · sürüm doğrulanamadı", Ekran = Ekran.Hata, Hata = HataBilgisi.SurumUyusmuyor("0.7.0", "0.8.0", gunluk) },
                new Sahne { Ad = "14-hata-makine", Etiket = "Hata · tüm kullanıcılara kurulu eski sürüm", Ekran = Ekran.Hata,
                    Hata = HataBilgisi.MakineKurulumu("C:\\Program Files\\Fuber AI") },
                new Sahne { Ad = "15-hata-hesap", Etiket = "Hata · başka hesapla yönetici olarak açıldı", Ekran = Ekran.Hata, Hata = HataBilgisi.FarkliHesap() },
            };
        }

        public static int Calistir(Secenekler s)
        {
            Bilgi bilgi = Bilgi.Oku();
            Directory.CreateDirectory(s.Onizleme);
            float[] olcekler = s.Olcek > 0 ? new[] { s.Olcek } : new[] { 1f, 1.5f };
            var json = new StringBuilder("{\"ekranlar\":[");
            var kareler = new List<string>();
            var temas = new List<KeyValuePair<string, string>>();
            bool ilk = true;
            foreach (float o in olcekler)
            {
                using (var p = new Pencere(s, bilgi))
                {
                    p.OnizlemeOlcegi(o);
                    foreach (Sahne sh in Sahneler())
                    {
                        p.OnizlemeSahnesi(sh.Ekran, sh.Ilerleme, sh.Asama, sh.Hata, sh.Zaman, sh.Odak, sh.Yukseltme);
                        string ad = sh.Ad + (Math.Abs(o - 1f) < 0.001f ? "" : "-" + (int)Math.Round(o * 100));
                        string dosya = Path.Combine(s.Onizleme, ad + ".png");
                        var kayit = new List<MetinKaydi>();
                        using (Bitmap tam = p.Resim(false, kayit))
                        using (Bitmap zemin = p.Resim(true, null))
                        {
                            tam.Save(dosya, ImageFormat.Png);
                            if (!ilk) json.Append(',');
                            ilk = false;
                            json.Append("{\"dosya\":").Append(Json.Metin(ad + ".png")).Append(",\"olcek\":").Append(Json.Sayi(o)).Append(",\"metinler\":[");
                            for (int i = 0; i < kayit.Count; i++)
                            {
                                MetinKaydi m = kayit[i];
                                Color z = EnKotuZemin(zemin, m, o);
                                if (i > 0) json.Append(',');
                                json.Append("{\"metin\":").Append(Json.Metin(m.Metin)).Append(",\"px\":").Append(Json.Sayi(m.Px))
                                    .Append(",\"renk\":").Append(Json.Renk(m.Renk)).Append(",\"zemin\":").Append(Json.Renk(z)).Append('}');
                            }
                            json.Append("],\"dugmeler\":[");
                            List<Dugme> dl = p.Dugmeler;
                            for (int i = 0; i < dl.Count; i++)
                            {
                                if (i > 0) json.Append(',');
                                json.Append("{\"metin\":").Append(Json.Metin(dl[i].Metin)).Append(",\"en\":").Append(Json.Sayi(dl[i].Alan.Width))
                                    .Append(",\"boy\":").Append(Json.Sayi(dl[i].Alan.Height)).Append('}');
                            }
                            json.Append("]}");
                        }
                        if (Math.Abs(o - 1f) < 0.001f) temas.Add(new KeyValuePair<string, string>(sh.Etiket, dosya));
                    }
                    p.OnizlemeSahnesi(Ekran.Kuruluyor, 0.5, 2, null, 1.0, false, false);
                    kareler.Add("{\"olcek\":" + Json.Sayi(o) + ",\"ms\":" + Json.Sayi(p.KareSuresi(90)) + "}");
                }
            }
            json.Append("],\"kare\":[").Append(string.Join(",", kareler)).Append("]}");
            File.WriteAllText(Path.Combine(s.Onizleme, "denetim.json"), json.ToString(), new UTF8Encoding(false));
            if (temas.Count > 0) TemasSayfasi(temas, Path.Combine(s.Onizleme, "temas.png"));
            Console.WriteLine("önizleme: " + s.Onizleme);
            return 0;
        }

        /// <summary>Yazının altındaki (yazısız çizimde) en kötü zemin: açık yazıda en parlak, koyu yazıda en koyu piksel.</summary>
        static Color EnKotuZemin(Bitmap zemin, MetinKaydi m, float o)
        {
            bool acikYazi = (m.Renk.R * 0.2126 + m.Renk.G * 0.7152 + m.Renk.B * 0.0722) > 128;
            int x0 = Math.Max(0, (int)Math.Floor(m.Alan.X * o)), y0 = Math.Max(0, (int)Math.Floor(m.Alan.Y * o));
            int x1 = Math.Min(zemin.Width - 1, (int)Math.Ceiling(m.Alan.Right * o)), y1 = Math.Min(zemin.Height - 1, (int)Math.Ceiling(m.Alan.Bottom * o));
            Color secilen = acikYazi ? Color.Black : Color.White;
            double secilenL = acikYazi ? -1 : 2;
            for (int y = y0; y <= y1; y += 1)
                for (int x = x0; x <= x1; x += 1)
                {
                    Color c = zemin.GetPixel(x, y);
                    double l = c.R * 0.2126 + c.G * 0.7152 + c.B * 0.0722;
                    if (acikYazi ? l > secilenL : l < secilenL) { secilenL = l; secilen = c; }
                }
            return Color.FromArgb(255, secilen.R, secilen.G, secilen.B);
        }

        /// <summary>100 % ekranları tek sayfada: Windows 11 köşesi (8 px) ve ince kenarla, nötr masaüstü zemininde.</summary>
        static void TemasSayfasi(List<KeyValuePair<string, string>> l, string dosya)
        {
            const int KENAR = 40, ARA = 28, ETIKET = 30, SUTUN = 2, BASLIK = 64;
            int w = (int)Pencere.EN, h = (int)Pencere.BOY;
            int satir = (l.Count + SUTUN - 1) / SUTUN;
            int W = KENAR * 2 + SUTUN * w + (SUTUN - 1) * ARA, H = KENAR * 2 + BASLIK + satir * (ETIKET + h) + (satir - 1) * ARA;
            using (var bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb))
            using (Graphics g = Graphics.FromImage(bmp))
            using (Font fb = Yazi.Kalin(20f))
            using (Font fe = Yazi.Metin(14f))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                using (var z = new LinearGradientBrush(new Rectangle(0, 0, W, H), Color.FromArgb(255, 30, 36, 50), Color.FromArgb(255, 12, 14, 19), LinearGradientMode.Vertical))
                    g.FillRectangle(z, 0, 0, W, H);
                using (var b = new SolidBrush(Color.FromArgb(255, 236, 238, 243)))
                    g.DrawString("Fuber AI Kurulum — ekranlar (100 %)", fb, b, KENAR, KENAR, Yazi.Bicim);
                for (int i = 0; i < l.Count; i++)
                {
                    int x = KENAR + (i % SUTUN) * (w + ARA), y = KENAR + BASLIK + (i / SUTUN) * (ETIKET + h + ARA);
                    using (var b = new SolidBrush(Color.FromArgb(255, 190, 196, 208))) g.DrawString(l[i].Key, fe, b, x, y + 4, Yazi.Bicim);
                    var r = new RectangleF(x, y + ETIKET, w, h);
                    using (Image im = Image.FromFile(l[i].Value))
                    using (GraphicsPath p = Sekil.Yuvarlak(r, 8f))
                    {
                        GraphicsState st = g.Save();
                        g.SetClip(p);
                        g.DrawImage(im, r);
                        g.Restore(st);
                        using (var k = new Pen(Color.FromArgb(70, 255, 255, 255), 1f)) g.DrawPath(k, p);
                    }
                }
                bmp.Save(dosya, ImageFormat.Png);
            }
        }
    }
}
