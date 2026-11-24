// Kurulum başlatıcısının çizim yardımcıları (Görev 17, K8). Renkler src/renderer/tasarim.css koyu belirteçleriyle AYNI değerler
// (başlatıcı web sayfası değil; belirteçler burada tek yerde): siyah sahne, #040405 pano + soğuk alt ışık, gümüş başlık, gri metin,
// beyaz hap. FUBER kelime markası derlemede src/shared/logo.ts'ten "logo.txt" kaynağına yazılır ve burada SVG yolu olarak çizilir
// (vektör: her DPI'da keskin). Yazı tipi Segoe UI Variable (yoksa Segoe UI); Yazı tipi dosyası dönüştürülmez, gömülmez (lisans).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace FuberKurulum
{
    /// <summary>"Çentik" koyu tema belirteçleri (tasarim.css :root ile aynı değerler).</summary>
    internal static class Renk
    {
        public static readonly Color Bg = Hex(0x000000);
        public static readonly Color Pano = Hex(0x040405);
        public static readonly Color Ink = Hex(0xffffff);
        public static readonly Color Metin = Hex(0xe9e9e9);
        public static readonly Color Ink2 = Hex(0xd6d6d6);
        public static readonly Color Ink3 = Hex(0xa1a1a1);
        public static readonly Color Ink4 = Hex(0x858585);
        public static readonly Color Gumus1 = Hex(0xb9bdcd);
        public static readonly Color Gumus2 = Hex(0xdfe4ee);
        public static readonly Color Dugme2 = Hex(0x262626);
        public static readonly Color Dugme2Ust = Hex(0x2f2f2f);
        public static readonly Color YaziHata = Hex(0xfca5a5);
        public static readonly Color YaziBasari = Hex(0x86efac);
        public static readonly Color Kirmizi = Hex(0xef4444);
        public static readonly Color Yesil = Hex(0x22c55e);
        public static readonly Color Mavi2 = Hex(0x4c85ff);
        public static readonly Color YeniIsik = Hex(0xe2e9ff);
        public static readonly Color AltIsik = Color.FromArgb(255, 200, 210, 240);

        public static Color Hex(int rgb) { return Color.FromArgb(255, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
        public static Color Beyaz(double a) { return Color.FromArgb(Bayt(a), 255, 255, 255); }
        /// <summary>Rengin alfasını k ile çarpar (ekran geçişindeki solma).</summary>
        public static Color Carp(Color c, double k) { return Color.FromArgb(Bayt(c.A / 255.0 * k), c.R, c.G, c.B); }
        public static int Bayt(double a)
        {
            int v = (int)Math.Round(a * 255);
            return v < 0 ? 0 : v > 255 ? 255 : v;
        }
    }

    /// <summary>Yazı tipleri (piksel birimli) ve tek satır / sarılan metin ölçümü.</summary>
    internal static class Yazi
    {
        public static readonly StringFormat Bicim = BicimOlustur();

        static StringFormat BicimOlustur()
        {
            var f = (StringFormat)StringFormat.GenericTypographic.Clone();
            f.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap | StringFormatFlags.NoClip;
            f.Trimming = StringTrimming.None;
            return f;
        }

        static Font Ilk(float px, string[] aileler, FontStyle[] stiller)
        {
            for (int i = 0; i < aileler.Length; i++)
            {
                try
                {
                    var ff = new FontFamily(aileler[i]);
                    if (ff.IsStyleAvailable(stiller[i])) return new Font(ff, px, stiller[i], GraphicsUnit.Pixel);
                }
                catch (ArgumentException) { }
            }
            return new Font(FontFamily.GenericSansSerif, px, FontStyle.Regular, GraphicsUnit.Pixel);
        }

        // Windows 11: Segoe UI Variable adlandırılmış örnekleri (Display büyük başlık, Text gövde, Small ≤ 13 px); Windows 10: Segoe UI.
        public static Font Baslik(float px)
        {
            return Ilk(px, new[] { "Segoe UI Variable Display Semib", "Segoe UI Semibold", "Segoe UI" },
                new[] { FontStyle.Regular, FontStyle.Regular, FontStyle.Bold });
        }
        public static Font Metin(float px)
        {
            return Ilk(px, new[] { "Segoe UI Variable Text", "Segoe UI" }, new[] { FontStyle.Regular, FontStyle.Regular });
        }
        public static Font Kalin(float px)
        {
            return Ilk(px, new[] { "Segoe UI Variable Text Semibold", "Segoe UI Semibold", "Segoe UI" },
                new[] { FontStyle.Regular, FontStyle.Regular, FontStyle.Bold });
        }
        public static Font Kucuk(float px)
        {
            return Ilk(px, new[] { "Segoe UI Variable Small", "Segoe UI" }, new[] { FontStyle.Regular, FontStyle.Regular });
        }
        public static Font KucukKalin(float px)
        {
            return Ilk(px, new[] { "Segoe UI Variable Small Semibol", "Segoe UI Semibold", "Segoe UI" },
                new[] { FontStyle.Regular, FontStyle.Regular, FontStyle.Bold });
        }

        /// <summary>Çizim noktasından taban çizgisine uzaklık (px).</summary>
        public static float Yukselis(Font f)
        {
            FontFamily ff = f.FontFamily;
            return f.Size * ff.GetCellAscent(f.Style) / ff.GetEmHeight(f.Style);
        }

        /// <summary>Yazıyı yüksekliği `boy` olan kutuda büyük harf yüksekliğine göre dikey ortalayan çizim y'si.</summary>
        public static float OrtaY(Font f, float kutuUst, float boy)
        {
            float taban = kutuUst + boy / 2f + 0.35f * f.Size;
            return taban - Yukselis(f);
        }

        public static float En(Graphics g, string m, Font f)
        {
            if (string.IsNullOrEmpty(m)) return 0;
            return g.MeasureString(m, f, PointF.Empty, Bicim).Width;
        }

        /// <summary>Sözcük sınırından satırlara böler (satır aralığını çağıran belirler).</summary>
        public static List<string> Sar(Graphics g, string metin, Font f, float en)
        {
            var satirlar = new List<string>();
            foreach (string paragraf in (metin ?? "").Split('\n'))
            {
                string satir = "";
                foreach (string sozcuk in paragraf.Split(' '))
                {
                    string aday = satir.Length == 0 ? sozcuk : satir + " " + sozcuk;
                    if (satir.Length > 0 && En(g, aday, f) > en) { satirlar.Add(satir); satir = sozcuk; }
                    else satir = aday;
                }
                satirlar.Add(satir);
            }
            return satirlar;
        }
    }

    /// <summary>Yollar: yuvarlak dikdörtgen, hap, çentik; radyal ışık.</summary>
    internal static class Sekil
    {
        public static GraphicsPath Yuvarlak(RectangleF r, float yc)
        {
            var p = new GraphicsPath();
            float d = Math.Min(yc * 2f, Math.Min(r.Width, r.Height));
            if (d <= 0.01f) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static GraphicsPath Hap(RectangleF r) { return Yuvarlak(r, r.Height / 2f); }

        /// <summary>
        /// Çerçeveden panoya oyulan çentik (tasarim.css .centik ile aynı omuz eğrisi: viewBox 64×40,
        /// "M0 0H64V40C46 40 40 31 32 20C24 9 18 0 0 0Z"). Gövde [xSol, xSag] × [ust, ust+boy]; omuzlar `omuz` genişliğinde.
        /// </summary>
        public static GraphicsPath Centik(float xSol, float xSag, float ust, float boy, float omuz)
        {
            float kx = omuz / 64f, ky = boy / 40f;
            var p = new GraphicsPath();
            float a = ust + boy;
            p.StartFigure();
            p.AddLine(xSol - omuz, ust, xSag + omuz, ust);
            // sağ omuz: (64,0) → (32,20) → (0,40) (yerel), xSag'a göre
            p.AddBezier(xSag + 64 * kx, ust, xSag + 46 * kx, ust, xSag + 40 * kx, ust + 9 * ky, xSag + 32 * kx, ust + 20 * ky);
            p.AddBezier(xSag + 32 * kx, ust + 20 * ky, xSag + 24 * kx, ust + 31 * ky, xSag + 18 * kx, a, xSag, a);
            p.AddLine(xSag, a, xSol, a);
            // sol omuz: (64,40) → (32,20) → (0,0) (yerel), xSol - omuz'a göre
            float x0 = xSol - omuz;
            p.AddBezier(x0 + 64 * kx, a, x0 + 46 * kx, a, x0 + 40 * kx, ust + 31 * ky, x0 + 32 * kx, ust + 20 * ky);
            p.AddBezier(x0 + 32 * kx, ust + 20 * ky, x0 + 24 * kx, ust + 9 * ky, x0 + 18 * kx, ust, x0, ust);
            p.CloseFigure();
            return p;
        }

        /// <summary>
        /// Elips biçimli yumuşak ışık. `konum` 0 = merkez … 1 = kenar (artan), `alfa` her duraktaki saydamlık.
        /// </summary>
        public static void RadyalIsik(Graphics g, PointF m, float rx, float ry, Color renk, float[] konum, float[] alfa)
        {
            if (rx < 1 || ry < 1) return;
            using (var yol = new GraphicsPath())
            {
                yol.AddEllipse(m.X - rx, m.Y - ry, rx * 2, ry * 2);
                using (var f = new PathGradientBrush(yol))
                {
                    f.CenterPoint = m;
                    int n = konum.Length;
                    var cb = new ColorBlend(n);
                    // PathGradientBrush'ta 0 = kenar, 1 = merkez: duraklar ters çevrilir.
                    for (int k = 0; k < n; k++)
                    {
                        cb.Colors[n - 1 - k] = Color.FromArgb(Renk.Bayt(alfa[k]), renk.R, renk.G, renk.B);
                        cb.Positions[n - 1 - k] = 1f - konum[k];
                    }
                    cb.Positions[0] = 0f;
                    cb.Positions[n - 1] = 1f;
                    f.InterpolationColors = cb;
                    g.FillPath(f, yol);
                }
            }
        }
    }

    /// <summary>Küçük bir SVG yol çözücüsü (M L H V C S Z, göreli/mutlak, örtük tekrar) → GraphicsPath.</summary>
    internal static class SvgYol
    {
        static readonly Regex Belirtec = new Regex(@"[MmLlHhVvCcSsZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?");

        public static void Ekle(GraphicsPath yol, string d)
        {
            var komutlar = new List<char>();
            var sayilar = new List<float>();
            var sira = new List<int>(); // her belirteç: >= 0 sayı dizini, -1 - k komut dizini
            foreach (Match m in Belirtec.Matches(d))
            {
                char c = m.Value[0];
                if (char.IsLetter(c) && c != 'e' && c != 'E') { komutlar.Add(c); sira.Add(-1 - (komutlar.Count - 1)); }
                else { sayilar.Add(float.Parse(m.Value, CultureInfo.InvariantCulture)); sira.Add(sayilar.Count - 1); }
            }
            int i = 0;
            char kom = 'M';
            PointF cur = PointF.Empty, bas = PointF.Empty, sonK = PointF.Empty;
            char onceki = ' ';
            Func<float> sayi = delegate
            {
                if (i >= sira.Count || sira[i] < 0) throw new FormatException("SVG yolunda sayı bekleniyordu");
                return sayilar[sira[i++]];
            };
            while (i < sira.Count)
            {
                if (sira[i] < 0) { kom = komutlar[-1 - sira[i]]; i++; }
                bool goreli = char.IsLower(kom);
                char K = char.ToUpperInvariant(kom);
                float ox = goreli ? cur.X : 0, oy = goreli ? cur.Y : 0;
                switch (K)
                {
                    case 'M':
                        {
                            float x = sayi() + ox, y = sayi() + oy;
                            yol.StartFigure();
                            cur = bas = new PointF(x, y);
                            kom = goreli ? 'l' : 'L'; // örtük tekrar: çizgi
                            onceki = 'M';
                            continue;
                        }
                    case 'L':
                        {
                            var p = new PointF(sayi() + ox, sayi() + oy);
                            yol.AddLine(cur, p); cur = p; break;
                        }
                    case 'H':
                        {
                            var p = new PointF(sayi() + ox, cur.Y);
                            yol.AddLine(cur, p); cur = p; break;
                        }
                    case 'V':
                        {
                            var p = new PointF(cur.X, sayi() + oy);
                            yol.AddLine(cur, p); cur = p; break;
                        }
                    case 'C':
                        {
                            var c1 = new PointF(sayi() + ox, sayi() + oy);
                            var c2 = new PointF(sayi() + ox, sayi() + oy);
                            var p = new PointF(sayi() + ox, sayi() + oy);
                            yol.AddBezier(cur, c1, c2, p); sonK = c2; cur = p; break;
                        }
                    case 'S':
                        {
                            PointF c1 = (onceki == 'C' || onceki == 'S') ? new PointF(2 * cur.X - sonK.X, 2 * cur.Y - sonK.Y) : cur;
                            var c2 = new PointF(sayi() + ox, sayi() + oy);
                            var p = new PointF(sayi() + ox, sayi() + oy);
                            yol.AddBezier(cur, c1, c2, p); sonK = c2; cur = p; break;
                        }
                    case 'Z':
                        yol.CloseFigure(); cur = bas;
                        // Z'den sonra sayı gelirse geçersiz; bir sonraki komut beklenir.
                        if (i < sira.Count && sira[i] >= 0) throw new FormatException("Z'den sonra sayı");
                        break;
                    default:
                        throw new FormatException("Desteklenmeyen SVG komutu: " + kom);
                }
                onceki = K;
            }
        }
    }

    /// <summary>Gömülü kaynaklar (derle.mjs → kurulumDerle /resource: adları).</summary>
    internal static class Kaynak
    {
        public static Stream Ac(string ad) { return Assembly.GetExecutingAssembly().GetManifestResourceStream(ad); }

        public static string Metin(string ad)
        {
            using (Stream s = Ac(ad))
            {
                if (s == null) return null;
                using (var r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
            }
        }

        /// <summary>FUBER kelime markası: logo.txt (1. satır viewBox, sonraki her satır bir yol) → birim yüksekliğe ölçekli yol.</summary>
        public static GraphicsPath Logo(out float enBoyOrani) { return Yol("logo.txt", FillMode.Alternate, out enBoyOrani); }

        /// <summary>
        /// Fuber AI'nin F işareti (mini logo; derle.mjs resources/ikon/kaynak/fuber-ai-mini.svg'den "isaret.txt" yazar). SVG varsayılanı gibi
        /// sıfırdan farklı sarımla doldurulur (uygulama ikonu üreticisiyle aynı kural).
        /// </summary>
        public static GraphicsPath FIsareti(out float enBoyOrani) { return Yol("isaret.txt", FillMode.Winding, out enBoyOrani); }

        /// <summary>Yol kaynağı (1. satır viewBox, sonraki her satır bir SVG yolu) → birim yüksekliğe ölçekli yol.</summary>
        static GraphicsPath Yol(string ad, FillMode kural, out float enBoyOrani)
        {
            enBoyOrani = 0;
            string m = Metin(ad);
            if (m == null) return null;
            string[] satirlar = m.Replace("\r", "").Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (satirlar.Length < 2) return null;
            string[] vb = satirlar[0].Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries);
            float vx = float.Parse(vb[0], CultureInfo.InvariantCulture), vy = float.Parse(vb[1], CultureInfo.InvariantCulture);
            float vw = float.Parse(vb[2], CultureInfo.InvariantCulture), vh = float.Parse(vb[3], CultureInfo.InvariantCulture);
            var yol = new GraphicsPath(kural);
            for (int i = 1; i < satirlar.Length; i++) SvgYol.Ekle(yol, satirlar[i]);
            using (var mt = new Matrix())
            {
                mt.Scale(1f / vh, 1f / vh);
                mt.Translate(-vx, -vy);
                yol.Transform(mt);
            }
            enBoyOrani = vw / vh;
            return yol;
        }
    }

    /// <summary>
    /// Pencerenin sağındaki Fuber görseli (fiziksel px, bir kez çizilip önbelleğe alınır): F işareti vektör olarak, yukarıdan aşağı beyazdan
    /// gümüşe geçişle (tasarim.css başlık gümüşü: #ffffff → #dfe4ee → #b9bdcd) doldurulur; arkasında işaretin kendi biçiminden süzülen çok
    /// hafif soğuk ışık (yumuşatılmış alfa, Renk.YeniIsik). Raster kaynak yok: her DPI'da keskin.
    /// </summary>
    internal static class Isaret
    {
        /// <summary>`birim`: yüksekliği 1 olan yol (Kaynak.FIsareti); `boy` işaretin fiziksel px yüksekliği; `pay` ışık için kenar payı (px).</summary>
        public static Bitmap Hazirla(GraphicsPath birim, float oran, int boy, int pay, float isikGucu)
        {
            if (birim == null || boy < 8) return null;
            int en = (int)Math.Ceiling(boy * oran);
            int w = en + 2 * pay, h = boy + 2 * pay;
            using (var yol = (GraphicsPath)birim.Clone())
            using (var mt = new Matrix())
            {
                mt.Translate(pay, pay);
                mt.Scale(boy, boy);
                yol.Transform(mt);

                // 1) Kapsama (alfa) → yumuşatılmış ışık.
                var alfa = new float[w * h];
                using (var m = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(m))
                    {
                        g.Clear(Color.Transparent);
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.FillPath(Brushes.White, yol);
                    }
                    BitmapData d = m.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    try
                    {
                        var v = new byte[d.Stride * h];
                        Marshal.Copy(d.Scan0, v, 0, v.Length);
                        for (int y = 0; y < h; y++)
                            for (int x = 0; x < w; x++) alfa[y * w + x] = v[y * d.Stride + x * 4 + 3] / 255f;
                    }
                    finally { m.UnlockBits(d); }
                }
                int r = Math.Max(1, pay / 3);
                for (int k = 0; k < 3; k++) { Bulanik(alfa, w, h, r, true); Bulanik(alfa, w, h, r, false); }

                var bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
                BitmapData b = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
                try
                {
                    var v = new byte[b.Stride * h];
                    var rnd = new Random(41);
                    Color c = Renk.YeniIsik;
                    for (int y = 0; y < h; y++)
                    {
                        for (int x = 0; x < w; x++)
                        {
                            // Işık işaretin biçimini taşır ama kenara doğru çabuk söner (yumuşak, halkasız; titreşimle 8 bite iner).
                            float a = Math.Min(1f, alfa[y * w + x] * 2.2f) * isikGucu;
                            if (a <= 0.0005f) continue;
                            float n = (float)(rnd.NextDouble() + rnd.NextDouble() - 1.0) * 0.6f;
                            int i = y * b.Stride + x * 4;
                            byte al = Bayt(a * 255f + n);
                            v[i + 3] = al;
                            v[i] = Math.Min(al, Bayt(c.B * a + n));
                            v[i + 1] = Math.Min(al, Bayt(c.G * a + n));
                            v[i + 2] = Math.Min(al, Bayt(c.R * a + n));
                        }
                    }
                    Marshal.Copy(v, 0, b.Scan0, v.Length);
                }
                finally { bmp.UnlockBits(b); }

                // 2) Keskin işaret: beyazdan gümüşe dikey geçiş.
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    var alan = new RectangleF(pay, pay - 1, en, boy + 2);
                    using (var f = new LinearGradientBrush(alan, Renk.Ink, Renk.Gumus1, LinearGradientMode.Vertical))
                    {
                        var cb = new ColorBlend(3);
                        cb.Colors = new[] { Renk.Ink, Renk.Gumus2, Renk.Gumus1 };
                        cb.Positions = new[] { 0f, 0.45f, 1f };
                        f.InterpolationColors = cb;
                        g.FillPath(f, yol);
                    }
                }
                return bmp;
            }
        }

        /// <summary>Kayan kutu bulanıklığı (yatay ya da dikey, yarıçap r); üç geçiş Gauss'a yaklaşır.</summary>
        static void Bulanik(float[] a, int w, int h, int r, bool yatay)
        {
            int n = yatay ? w : h, satir = yatay ? h : w;
            var tampon = new float[n];
            float bol = 1f / (2 * r + 1);
            for (int s = 0; s < satir; s++)
            {
                for (int i = 0; i < n; i++) tampon[i] = a[yatay ? s * w + i : i * w + s];
                float top = 0;
                for (int i = -r; i <= r; i++) top += i >= 0 && i < n ? tampon[i] : 0f;
                for (int i = 0; i < n; i++)
                {
                    a[yatay ? s * w + i : i * w + s] = top * bol;
                    int cik = i - r, gir = i + r + 1;
                    if (cik >= 0) top -= tampon[cik];
                    if (gir < n) top += tampon[gir];
                }
            }
        }

        static byte Bayt(float x)
        {
            int v = (int)Math.Round(x);
            return (byte)(v < 0 ? 0 : v > 255 ? 255 : v);
        }
    }

    /// <summary>Elips biçimli ışık kaynağı (fiziksel px). Duraklar arası yumuşak (smoothstep) geçiş: halka/Mach bandı olmaz.</summary>
    internal sealed class IsikKaynagi
    {
        public readonly float X, Y, Rx, Ry;
        public readonly Color Renk;
        readonly float[] konum, alfa;

        public IsikKaynagi(float x, float y, float rx, float ry, Color renk, float[] konum, float[] alfa)
        {
            X = x; Y = y; Rx = rx; Ry = ry; Renk = renk; this.konum = konum; this.alfa = alfa;
        }

        /// <summary>Normalize uzaklıkta (0 merkez, 1 kenar) alfa.</summary>
        public float Deger(float d)
        {
            if (d <= konum[0]) return alfa[0];
            for (int i = 1; i < konum.Length; i++)
            {
                if (d <= konum[i])
                {
                    float t = (d - konum[i - 1]) / (konum[i] - konum[i - 1]);
                    t = t * t * (3 - 2 * t);
                    return alfa[i - 1] + (alfa[i] - alfa[i - 1]) * t;
                }
            }
            return alfa[alfa.Length - 1];
        }

        public float Uc { get { return konum[konum.Length - 1]; } }
        public bool SondaSifir { get { return alfa[alfa.Length - 1] <= 0f; } }
    }

    /// <summary>
    /// GDI+ PathGradientBrush büyük koyu degradelerde görünür halkalar (bant) çiziyor; sahnenin ışıkları bu yüzden piksel piksel,
    /// kayan noktada hesaplanır ve 8 bite titreşimle (dither) iner. Bir kez çizilip önbelleğe alınır.
    /// </summary>
    internal static class Isik
    {
        /// <summary>Opak sahne: siyah çerçeve + yuvarlak köşeli pano (taban renk + ışıklar); pano kenarı yumuşak kapsamayla karışır.</summary>
        public static Bitmap Sahne(int w, int h, GraphicsPath pano, Color taban, IsikKaynagi[] isiklar)
        {
            var kapsama = new float[w * h];
            using (var m = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(m))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.FillPath(Brushes.White, pano);
                }
                BitmapData d = m.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                try
                {
                    var v = new byte[d.Stride * h];
                    Marshal.Copy(d.Scan0, v, 0, v.Length);
                    for (int y = 0; y < h; y++)
                        for (int x = 0; x < w; x++) kapsama[y * w + x] = v[y * d.Stride + x * 4 + 3] / 255f;
                }
                finally { m.UnlockBits(d); }
            }
            var bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            BitmapData b = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
            try
            {
                var v = new byte[b.Stride * h];
                var rnd = new Random(17);
                for (int y = 0; y < h; y++)
                {
                    for (int x = 0; x < w; x++)
                    {
                        int i = y * b.Stride + x * 4;
                        v[i + 3] = 255;
                        float c = kapsama[y * w + x];
                        if (c <= 0f) continue;
                        float r = taban.R, gg = taban.G, bb = taban.B;
                        foreach (IsikKaynagi k in isiklar)
                        {
                            float dx = (x + 0.5f - k.X) / k.Rx, dy = (y + 0.5f - k.Y) / k.Ry;
                            float uz = (float)Math.Sqrt(dx * dx + dy * dy);
                            if (uz >= k.Uc && k.SondaSifir) continue;
                            float a = k.Deger(uz);
                            r += (k.Renk.R - r) * a;
                            gg += (k.Renk.G - gg) * a;
                            bb += (k.Renk.B - bb) * a;
                        }
                        float n = (float)(rnd.NextDouble() + rnd.NextDouble() - 1.0) * 0.75f; // üçgen dağılımlı titreşim
                        v[i] = Bayt(bb * c + n);
                        v[i + 1] = Bayt(gg * c + n);
                        v[i + 2] = Bayt(r * c + n);
                    }
                }
                Marshal.Copy(v, 0, b.Scan0, v.Length);
            }
            finally { bmp.UnlockBits(b); }
            return bmp;
        }

        /// <summary>Saydam, önceden çarpılmış yuvarlak ışık lekesi (kenar `boyut`/2'de söner); `kat` alfa çarpanı.</summary>
        public static Bitmap Leke(int boyut, Color renk, float[] konum, float[] alfa, float kat)
        {
            var k = new IsikKaynagi(boyut / 2f, boyut / 2f, boyut / 2f, boyut / 2f, renk, konum, alfa);
            var bmp = new Bitmap(boyut, boyut, PixelFormat.Format32bppPArgb);
            BitmapData b = bmp.LockBits(new Rectangle(0, 0, boyut, boyut), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
            try
            {
                var v = new byte[b.Stride * boyut];
                var rnd = new Random(29);
                for (int y = 0; y < boyut; y++)
                {
                    for (int x = 0; x < boyut; x++)
                    {
                        float dx = (x + 0.5f - k.X) / k.Rx, dy = (y + 0.5f - k.Y) / k.Ry;
                        float a = k.Deger((float)Math.Sqrt(dx * dx + dy * dy)) * kat;
                        if (a <= 0f) continue;
                        float n = (float)(rnd.NextDouble() + rnd.NextDouble() - 1.0) * 0.6f;
                        int i = y * b.Stride + x * 4;
                        byte al = Bayt(a * 255f + n);
                        v[i + 3] = al;
                        v[i] = Math.Min(al, Bayt(renk.B * a + n));
                        v[i + 1] = Math.Min(al, Bayt(renk.G * a + n));
                        v[i + 2] = Math.Min(al, Bayt(renk.R * a + n));
                    }
                }
                Marshal.Copy(v, 0, b.Scan0, v.Length);
            }
            finally { bmp.UnlockBits(b); }
            return bmp;
        }

        static byte Bayt(float x)
        {
            int v = (int)Math.Round(x);
            return (byte)(v < 0 ? 0 : v > 255 ? 255 : v);
        }
    }
}
