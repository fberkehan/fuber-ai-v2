// Kurulum başlatıcısının penceresi (Görev 17, K8): çerçevesiz, Windows 11'de DWM yuvarlak köşeli, koyu "Çentik" dili.
// Akış: Hoş geldin → (Fuber AI açıksa: Uygulama açık → Kapatılıyor) → Kuruluyor → Hazır ("Fuber AI açılıyor…": uygulama açılır,
// pencere kapanır); her adımdan Hata ("Tekrar dene" / "Kapat"). Her şey tek OnPaint'te mantıksal (96 DPI) birimlerle çizilir ve DPI
// ölçeğiyle büyütülür (Per-Monitor V2, WM_DPICHANGED). Düğmeler çizimdir: fare + klavye (Tab/oklar, Enter/Boşluk, Esc).
// Önizleme kipi (--onizleme) aynı çizimi DrawToBitmap ile PNG'ye alır; masaüstü yakalanmaz.
using System;
using System.Collections.Generic;
using System.Diagnostics;
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
using Timer = System.Windows.Forms.Timer;

namespace FuberKurulum
{
    internal enum Ekran { HosGeldin, UygulamaAcik, Kapatiliyor, Kuruluyor, Hazir, Hata }
    internal enum DugmeTuru { Beyaz, Koyu, Kucult, Kapat }

    internal sealed class Dugme
    {
        public string Metin;
        public DugmeTuru Tur;
        public RectangleF Alan;
        public Action Eylem;
        public bool Gorunur = true;
        public bool Simge { get { return Tur == DugmeTuru.Kucult || Tur == DugmeTuru.Kapat; } }
    }

    /// <summary>Önizleme denetimi: çizilen her yazının boyutu, rengi ve yeri (okunurluk denetimi zemini buradan örnekler).</summary>
    internal sealed class MetinKaydi
    {
        public string Metin;
        public float Px;
        public Color Renk;
        public RectangleF Alan;
    }

    internal sealed class Pencere : Form
    {
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool ShutdownBlockReasonCreate(IntPtr h, string neden);
        [DllImport("user32.dll")] static extern bool ShutdownBlockReasonDestroy(IntPtr h);
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

        // Mantıksal ölçüler (96 DPI px).
        public const float EN = 720f, BOY = 440f;
        // ISARET_BOY: sağdaki F işaretinin yüksekliği; ISARET_PAY: arkasındaki ışığın taşma payı; HALE: nabız ışığının yarıçapı.
        const float CERCEVE = 8f, PANO_YC = 20f, SOL = 56f, SUTUN = 340f, ISARET_BOY = 164f, ISARET_PAY = 36f, HALE = 160f;
        const float CENTIK_BOY = 34f, CENTIK_OMUZ = 48f, LOGO_BOY = 12f, ICERIK_MERKEZ = 224f, BASLIK_EN = 400f;
        const int NABIZ_DUZEY = 16;
        static readonly PointF IsaretMerkez = new PointF(EN - 176f, 230f);

        /// <summary>Çizim katmanı: Yok = yalnız yerleşim; Sabit = önbelleğe alınan yazılar; Degisken = düğme, ilerleme, not.</summary>
        enum Katman { Yok, Hepsi, Sabit, Degisken }

        readonly Secenekler s;
        readonly Bilgi bilgi;
        readonly Kurucu kurucu;
        readonly bool onizleme;
        float olcek = 1f;

        // Akış durumu
        Ekran ekran = Ekran.HosGeldin;
        int ekranSayaci;
        double ekranBas;
        bool devam;          // Kuruluyor → Hazır: ilerleme çubuğu yeniden "girmez", akmaya devam eder
        bool yukseltme;      // hedefte önceki kurulum var
        HataBilgisi hata;
        string faz = "";
        double cikarOrani, nsisBas, hedef, gosterilen;
        long boyut = -1, ilkBoyut = -1, enAz = long.MaxValue;
        int durumAsama;
        string not;
        double notBitis;
        int otomatikTekrar;
        public int CikisKodu = 1;

        // Girdi
        readonly List<Dugme> dugmeler = new List<Dugme>();
        readonly Dugme dKucult, dKapat;
        Dugme uzerinde, basili;
        int odak = -1;
        bool klavyeOdak;

        // Zaman ve solma
        readonly Timer zaman = new Timer();
        readonly Stopwatch saat = Stopwatch.StartNew();
        double donukZaman = -1, sonTik;
        int solma;            // 1 giriş, -1 çıkış
        double solmaBas;
        bool kapaniyor, kapanisIzinli, kapanmaEngeli;

        // Önbellek (fiziksel px): sahne (çerçeve + pano ışıkları + çentik), F işareti, nabız ışığı düzeyleri, ekranın sabit yazıları.
        Bitmap zemin, isaret, icerik, parilti;
        readonly Bitmap[] nabizlar = new Bitmap[NABIZ_DUZEY];
        int icerikAnahtar = -1;
        readonly GraphicsPath logo, fIsareti;
        readonly float logoOran, fIsaretiOran;
        readonly Font fBaslik, fAciklama, fDugme, fKucuk, fDurum, fRozet;

        // Önizleme denetimi
        List<MetinKaydi> denetim;
        bool metinsiz;

        // Rapor (--rapor; kuru kip)
        readonly List<string> rEkranlar = new List<string>();
        readonly List<List<double>> rIlerleme = new List<List<double>>(); // her kurulum denemesi ayrı dizi
        readonly List<string> rDurumlar = new List<string>();
        readonly List<int> rNsis = new List<int>();
        string rKapatma, rAcilis, rIkon;
        bool rUygulamaAcildi;
        double rSonOrnek = -1;

        public Pencere(Secenekler s, Bilgi bilgi)
        {
            this.s = s;
            this.bilgi = bilgi;
            onizleme = s.Onizleme != null;
            kurucu = new Kurucu(s, bilgi);
            Text = "Fuber AI Kurulum";
            AccessibleName = Text;
            FormBorderStyle = FormBorderStyle.None;
            AutoScaleMode = AutoScaleMode.None;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.Black;
            ShowInTaskbar = !s.Gizli;
            KeyPreview = true;
            MaximizeBox = false;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Opaque, true);
            try
            {
                using (Stream st = Kaynak.Ac("ikon.ico"))
                    if (st != null) Icon = new Icon(st);
            }
            catch { }

            fBaslik = Yazi.Baslik(30f);
            fAciklama = Yazi.Metin(14.5f);
            fDugme = Yazi.Kalin(14f);
            fKucuk = Yazi.Kucuk(12.5f);
            fDurum = Yazi.Metin(13f);
            fRozet = Yazi.KucukKalin(12.5f);
            try { logo = Kaynak.Logo(out logoOran); }
            catch (Exception e) { logo = null; kurucu.Gunluk.Yaz("logo çözülemedi: " + e.Message); }
            try { fIsareti = Kaynak.FIsareti(out fIsaretiOran); }
            catch (Exception e) { fIsareti = null; kurucu.Gunluk.Yaz("F işareti çözülemedi: " + e.Message); }

            dKucult = new Dugme { Tur = DugmeTuru.Kucult, Metin = "Küçült", Alan = new RectangleF(EN - CERCEVE - 12f - 32f - 34f, CERCEVE + 9f, 32f, 32f) };
            dKucult.Eylem = delegate { WindowState = FormWindowState.Minimized; };
            dKapat = new Dugme { Tur = DugmeTuru.Kapat, Metin = "Kapat", Alan = new RectangleF(EN - CERCEVE - 12f - 32f, CERCEVE + 9f, 32f, 32f) };
            dKapat.Eylem = KapatIstegi;

            zaman.Interval = 15;
            zaman.Tick += delegate { Tik(); };
            ClientSize = new Size((int)EN, (int)BOY);
            if (s.Gizli) Location = new Point(-20000, -20000);
            else
            {
                Rectangle ek = Screen.FromPoint(Cursor.Position).WorkingArea;
                Location = new Point(ek.Left + (ek.Width - (int)EN) / 2, ek.Top + (ek.Height - (int)BOY) / 2);
                if (!onizleme) Opacity = 0;
            }
            EkranaGec(Ekran.HosGeldin);
        }

        // ── Pencere ──────────────────────────────────────────────────────────────────────────────────────────────────

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.Style |= 0x00020000 | 0x00080000;   // WS_MINIMIZEBOX | WS_SYSMENU: görev çubuğundan küçült / geri getir
                cp.ClassStyle |= 0x00020000;            // CS_DROPSHADOW
                if (s != null && s.Gizli) cp.ExStyle |= 0x00000080 | 0x08000000; // WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE (test)
                return cp;
            }
        }

        protected override bool ShowWithoutActivation { get { return s != null && s.Gizli; } }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (onizleme) return;
            float dpi = 96f;
            try
            {
                uint d = GetDpiForWindow(Handle);
                if (d > 0) dpi = d;
            }
            catch (EntryPointNotFoundException)
            {
                using (Graphics g = CreateGraphics()) dpi = g.DpiX;
            }
            olcek = dpi / 96f;
            Size yeni = new Size((int)Math.Round(EN * olcek), (int)Math.Round(BOY * olcek));
            if (s.Gizli) ClientSize = yeni;
            else
            {
                Rectangle ek = Screen.FromPoint(Cursor.Position).WorkingArea;
                Bounds = new Rectangle(ek.Left + (ek.Width - yeni.Width) / 2, ek.Top + (ek.Height - yeni.Height) / 2, yeni.Width, yeni.Height);
            }
            OnbellekSil();
            Yerlestir();
            try
            {
                int v = 2; DwmSetWindowAttribute(Handle, 33, ref v, 4);            // DWMWA_WINDOW_CORNER_PREFERENCE: yuvarlak
                int koyu = 1; DwmSetWindowAttribute(Handle, 20, ref koyu, 4);      // DWMWA_USE_IMMERSIVE_DARK_MODE
                int kenar = 0x00262626; DwmSetWindowAttribute(Handle, 34, ref kenar, 4); // DWMWA_BORDER_COLOR (0x00BBGGRR)
            }
            catch { }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x02E0 && !onizleme) // WM_DPICHANGED: yeni ölçek + Windows'un önerdiği dikdörtgen
            {
                int dpi = (int)((long)m.WParam & 0xFFFF);
                var r = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
                olcek = dpi / 96f;
                OnbellekSil();
                SetBounds(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
                Yerlestir();
                Invalidate();
                m.Result = IntPtr.Zero;
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (!s.Gizli) { solma = 1; solmaBas = Simdi(); }
            zaman.Start();
            // Yarıda kalmış eski kurulumların geçici paketleri (~150 MB) arka planda silinir.
            ThreadPool.QueueUserWorkItem(delegate { kurucu.EskiGecicileriTemizle(); });
        }

        /// <summary>
        /// Kurulum sürerken Windows kapanmak isterse kapanma ekranında nedeni gösterilir ve kapanma engellenir (kullanıcı yine de
        /// "Yine de kapat" diyebilir); kurulum bitince engel kalkar.
        /// </summary>
        void KapanmaEngeli(bool ac)
        {
            if (onizleme || !IsHandleCreated || ac == kapanmaEngeli) return;
            bool ok;
            try { ok = ac ? ShutdownBlockReasonCreate(Handle, "Fuber AI kuruluyor. Kurulum bitince bilgisayar kapanabilir.") : ShutdownBlockReasonDestroy(Handle); }
            catch { ok = false; }
            kapanmaEngeli = ac;
            kurucu.Gunluk.Yaz("kapanma engeli " + (ac ? "açık" : "kapalı") + (ok ? "" : " (Windows kabul etmedi)"));
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!kapanisIzinli && e.CloseReason == CloseReason.WindowsShutDown && (ekran == Ekran.Kuruluyor || ekran == Ekran.Kapatiliyor))
            {
                kurucu.Gunluk.Yaz("Windows kapanmak istedi; kurulum sürdüğü için engellendi");
                e.Cancel = true;
                return;
            }
            // Kullanıcı kapatması (Alt+F4 → UserClosing; başka süreçten WM_CLOSE → None) akışa göre karar verir; kurulum sürerken
            // pencere kapanmaz. Windows kapanırken (WindowsShutDown) yalnız kurulum ve uygulama kapatma sürerken engellenir (yukarıda,
            // kapanma ekranında nedeniyle); başka ekranlarda Windows'un kapanması engellenmez.
            if (!kapanisIzinli && (e.CloseReason == CloseReason.UserClosing || e.CloseReason == CloseReason.None))
            {
                e.Cancel = true;
                KapatIstegi();
                return;
            }
            base.OnFormClosing(e);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            zaman.Stop();
            KapanmaEngeli(false);
            bool silindi = kurucu.Temizle();
            if (!onizleme) kurucu.Gunluk.Yaz("pencere kapandı; çıkış kodu " + CikisKodu);
            if (s.Rapor != null) RaporYaz(silindi);
            base.OnFormClosed(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                zaman.Dispose();
                OnbellekSil();
                if (parilti != null) parilti.Dispose();
                if (logo != null) logo.Dispose();
                if (fIsareti != null) fIsareti.Dispose();
                foreach (Font f in new[] { fBaslik, fAciklama, fDugme, fKucuk, fDurum, fRozet }) if (f != null) f.Dispose();
            }
            base.Dispose(disposing);
        }

        void OnbellekSil()
        {
            if (zemin != null) { zemin.Dispose(); zemin = null; }
            if (isaret != null) { isaret.Dispose(); isaret = null; }
            if (icerik != null) { icerik.Dispose(); icerik = null; }
            for (int i = 0; i < nabizlar.Length; i++) if (nabizlar[i] != null) { nabizlar[i].Dispose(); nabizlar[i] = null; }
        }

        double Simdi() { return donukZaman >= 0 ? donukZaman : saat.Elapsed.TotalSeconds; }

        void Sonra(int ms, Action a)
        {
            var t = new Timer();
            t.Interval = Math.Max(1, ms);
            t.Tick += delegate { t.Stop(); t.Dispose(); if (!IsDisposed) a(); };
            t.Start();
        }

        void UI(Action a)
        {
            try { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); }
            catch (InvalidOperationException) { }
        }

        void Arkada(ThreadStart is_)
        {
            var th = new Thread(delegate()
            {
                try { is_(); }
                catch (KurulumIstisnasi e) { UI(delegate { HataGoster(e.Hata); }); }
                catch (Exception e)
                {
                    kurucu.Gunluk.Yaz("beklenmeyen: " + e);
                    UI(delegate { HataGoster(HataBilgisi.Beklenmeyen(e.Message, kurucu.Gunluk.KisaYol)); });
                }
            });
            th.IsBackground = true;
            th.Start();
        }

        // ── Akış ─────────────────────────────────────────────────────────────────────────────────────────────────────

        void EkranaGec(Ekran e)
        {
            devam = ekran == Ekran.Kuruluyor && e == Ekran.Hazir;
            ekran = e;
            ekranSayaci++;
            ekranBas = Simdi();
            dugmeler.Clear();
            switch (e)
            {
                case Ekran.HosGeldin:
                    Ekle("Kur", DugmeTuru.Beyaz, KurBasildi);
                    break;
                case Ekran.UygulamaAcik:
                    Ekle("Kapat ve kur", DugmeTuru.Beyaz, KapatVeKur);
                    Ekle("Vazgeç", DugmeTuru.Koyu, KapatIstegi);
                    break;
                case Ekran.Hata:
                    if (hata.Tekrar) { Ekle("Tekrar dene", DugmeTuru.Beyaz, TekrarDene); Ekle("Kapat", DugmeTuru.Koyu, KapatIstegi); }
                    else Ekle("Kapat", DugmeTuru.Beyaz, KapatIstegi);
                    break;
            }
            dKapat.Gorunur = e != Ekran.Kuruluyor && e != Ekran.Kapatiliyor && e != Ekran.Hazir;
            dugmeler.Add(dKucult);
            dugmeler.Add(dKapat);
            odak = klavyeOdak ? 0 : -1;
            uzerinde = basili = null;
            AccessibleDescription = BaslikMetni() + ". " + AciklamaMetni();
            Yerlestir();
            KapanmaEngeli(e == Ekran.Kuruluyor || e == Ekran.Kapatiliyor);
            rEkranlar.Add(EkranAdi(e));
            if (!onizleme) zaman.Start();
            Invalidate();
            OtomatikPlanla();
        }

        void Ekle(string metin, DugmeTuru tur, Action eylem) { dugmeler.Add(new Dugme { Metin = metin, Tur = tur, Eylem = eylem }); }

        static string EkranAdi(Ekran e)
        {
            switch (e)
            {
                case Ekran.HosGeldin: return "hos-geldin";
                case Ekran.UygulamaAcik: return "uygulama-acik";
                case Ekran.Kapatiliyor: return "kapatiliyor";
                case Ekran.Kuruluyor: return "kuruluyor";
                case Ekran.Hazir: return "hazir";
                default: return "hata";
            }
        }

        void KurBasildi()
        {
            HataBilgisi on = kurucu.OnKosullar();
            if (on != null) { HataGoster(on); return; }
            if (kurucu.AcikMiKaydet()) { EkranaGec(Ekran.UygulamaAcik); return; }
            KurulumuBaslat();
        }

        void TekrarDene() { KurBasildi(); }

        void KapatVeKur()
        {
            EkranaGec(Ekran.Kapatiliyor);
            double bas = Simdi();
            Arkada(delegate
            {
                string sonuc = kurucu.UygulamayiKapat();
                UI(delegate
                {
                    rKapatma = sonuc;
                    // Ekran bir an yanıp sönmesin: en az 0,9 sn görünür.
                    int kalan = (int)Math.Max(0, (0.9 - (Simdi() - bas)) * 1000);
                    Sonra(kalan, delegate
                    {
                        if (sonuc == null) HataGoster(HataBilgisi.Kapatilamadi(kurucu.Gunluk.KisaYol));
                        else KurulumuBaslat();
                    });
                });
            });
        }

        void KurulumuBaslat()
        {
            yukseltme = Kurucu.KlasorBoyutu(kurucu.Hedef) > 0;
            faz = "cikar";
            cikarOrani = 0;
            boyut = -1;
            ilkBoyut = -1;
            enAz = long.MaxValue;
            hedef = gosterilen = 0;
            durumAsama = 0;
            nsisBas = Simdi();
            rIlerleme.Add(new List<double>());
            EkranaGec(Ekran.Kuruluyor);
            Arkada(delegate
            {
                int kod = kurucu.Kur(delegate(string f, double o, long b) { UI(delegate { Bildirim(f, o, b); }); });
                UI(delegate { KurulumBitti(kod); });
            });
        }

        void Bildirim(string f, double oran, long b)
        {
            if (ekran != Ekran.Kuruluyor) return;
            if (f == "cikar") cikarOrani = oran;
            else if (f == "kur")
            {
                if (faz != "kur") { faz = "kur"; nsisBas = Simdi(); ilkBoyut = b; if (durumAsama < 1) durumAsama = 1; }
                boyut = b;
            }
        }

        void KurulumBitti(int kod)
        {
            rNsis.Add(kod);
            if (kod != 0) { HataGoster(HataBilgisi.Nsis(kod, kurucu.Gunluk.KisaYol)); return; }
            // Başarı demeden önce: exe yerinde ve sürümü gömülü sürümle aynı mı.
            HataBilgisi dogrulama = kurucu.UygulamayiDogrula();
            if (dogrulama != null) { HataGoster(dogrulama); return; }
            // Görev 22 (K13): yeni ikon kabukta hemen görünsün (bayat ikon önbelleği); kurulumu asla düşürmez.
            try { rIkon = kurucu.KabukIkonlariniTazele(); }
            catch (Exception e) { rIkon = "hata: " + e.Message; kurucu.Gunluk.Yaz("kabuk ikonları tazelenemedi: " + e); }
            faz = "bitti";
            EkranaGec(Ekran.Hazir);
            int sayac = ekranSayaci;
            Sonra(900, delegate
            {
                if (ekranSayaci != sayac) return;
                try { rAcilis = kurucu.UygulamayiAc(); rUygulamaAcildi = true; }
                catch (Exception e)
                {
                    kurucu.Gunluk.Yaz("uygulama açılamadı: " + e.Message);
                    HataGoster(HataBilgisi.Acilamadi(e.Message));
                    return;
                }
                Sonra(1600, delegate { if (ekranSayaci == sayac) { CikisKodu = 0; Kapanis(); } });
            });
        }

        void HataGoster(HataBilgisi h)
        {
            hata = h;
            kurucu.Gunluk.Yaz("HATA: " + h.Baslik + (string.IsNullOrEmpty(h.Ayrinti) ? "" : " — " + h.Ayrinti.Replace("\n", " · ")));
            EkranaGec(Ekran.Hata);
        }

        void KapatIstegi()
        {
            switch (ekran)
            {
                case Ekran.HosGeldin:
                case Ekran.UygulamaAcik:
                    CikisKodu = 1; Kapanis(); break;
                case Ekran.Hata:
                    CikisKodu = hata.CikisKodu; Kapanis(); break;
                case Ekran.Kuruluyor:
                case Ekran.Kapatiliyor:
                    NotGoster("Kurulum bitince bu pencere kendiliğinden kapanır."); break;
            }
        }

        void NotGoster(string m)
        {
            not = m;
            notBitis = Simdi() + 3.0;
            zaman.Start();
            Invalidate();
        }

        void Kapanis()
        {
            if (kapaniyor) return;
            kapaniyor = true;
            kapanisIzinli = true;
            if (s.Gizli || onizleme || !Visible) { Close(); return; }
            solma = -1;
            solmaBas = Simdi();
            zaman.Start();
        }

        void OtomatikPlanla()
        {
            if (!s.Otomatik || onizleme) return;
            int sayac = ekranSayaci;
            Action eylem = null;
            if (ekran == Ekran.HosGeldin) eylem = KurBasildi;
            else if (ekran == Ekran.UygulamaAcik) eylem = KapatVeKur;
            else if (ekran == Ekran.Hata)
            {
                if (hata.Tekrar && otomatikTekrar < 1) eylem = delegate { otomatikTekrar++; TekrarDene(); };
                else eylem = KapatIstegi;
            }
            if (eylem != null) Sonra(450, delegate { if (ekranSayaci == sayac) eylem(); });
        }

        // ── Zaman, ilerleme ──────────────────────────────────────────────────────────────────────────────────────────

        void Tik()
        {
            double t = Simdi();
            double dt = Math.Max(0, Math.Min(0.1, t - sonTik));
            sonTik = t;
            if (solma == 1)
            {
                double k = (t - solmaBas) / 0.16;
                if (k >= 1) { Opacity = 1; solma = 0; } else Opacity = k;
            }
            else if (solma == -1)
            {
                double k = (t - solmaBas) / 0.2;
                if (k >= 1) { solma = 0; Opacity = 0; Close(); return; }
                Opacity = 1 - k;
            }
            if (ekran == Ekran.Kuruluyor || ekran == Ekran.Hazir) IlerlemeGuncelle(t, dt);
            if (s.Rapor != null) Ornekle(t);
            if (Canli()) Invalidate();
            else if (solma == 0) zaman.Stop();
        }

        bool Canli()
        {
            double t = Simdi();
            return ekran == Ekran.Kapatiliyor || ekran == Ekran.Kuruluyor || ekran == Ekran.Hazir || t - ekranBas < 0.5 || solma != 0
                || (not != null && t < notBitis + 0.1);
        }

        /// <summary>
        /// İlerleme: paket çıkarma %0–6; NSIS sürerken hedef klasör boyutu / beklenen boyut (yükseltmede klasör önce boşalır: en düşük
        /// boyuttan sayılır), boyut bilinmiyorsa zamana göre yumuşak eğri; çıkıştan önce %97'de durur, hiç geri gitmez.
        /// </summary>
        void IlerlemeGuncelle(double t, double dt)
        {
            double hedefOran = hedef;
            if (ekran == Ekran.Hazir) hedefOran = 1;
            else if (faz == "cikar") hedefOran = 0.06 * cikarOrani;
            else if (faz == "kur")
            {
                long beklenen = kurucu.BeklenenBoyut;
                double b = 0;
                if (beklenen > 0 && boyut >= 0)
                {
                    if (boyut < enAz) enAz = boyut;
                    double pay = beklenen - enAz;
                    if (pay > beklenen * 0.25) b = Math.Max(0, Math.Min(1, (boyut - enAz) / pay));
                }
                double z = 1 - Math.Exp(-(t - nsisBas) / 22.0);
                hedefOran = Math.Min(0.97, 0.06 + 0.91 * Math.Max(b, 0.85 * z));
                int asama = b >= 0.97 ? 3 : (b >= 0.03 || (beklenen <= 0 && z > 0.15)) ? 2 : 1;
                if (asama > durumAsama) durumAsama = asama;
            }
            if (hedefOran > hedef) hedef = hedefOran;
            double yaklas = 1 - Math.Exp(-dt / (ekran == Ekran.Hazir ? 0.12 : 0.22));
            gosterilen += (hedef - gosterilen) * yaklas;
            if (hedef - gosterilen < 0.0005) gosterilen = hedef;
        }

        void Ornekle(double t)
        {
            string d = DurumMetni();
            if (ekran == Ekran.Kuruluyor || ekran == Ekran.Hazir || ekran == Ekran.Kapatiliyor)
                if (rDurumlar.Count == 0 || rDurumlar[rDurumlar.Count - 1] != d) rDurumlar.Add(d);
            if ((ekran == Ekran.Kuruluyor || ekran == Ekran.Hazir) && t - rSonOrnek >= 0.1 && rIlerleme.Count > 0)
            {
                rSonOrnek = t;
                rIlerleme[rIlerleme.Count - 1].Add(Math.Round(gosterilen, 4));
            }
        }

        // ── Metinler ─────────────────────────────────────────────────────────────────────────────────────────────────

        string BaslikMetni()
        {
            switch (ekran)
            {
                case Ekran.HosGeldin: return "Fuber AI’ı kuralım";
                case Ekran.UygulamaAcik: return "Fuber AI şu an açık";
                case Ekran.Kapatiliyor: return "Fuber AI kapatılıyor";
                case Ekran.Kuruluyor: return "Fuber AI kuruluyor";
                case Ekran.Hazir: return "Fuber AI açılıyor…";
                default: return hata != null ? hata.Baslik : "";
            }
        }

        string AciklamaMetni()
        {
            switch (ekran)
            {
                case Ekran.HosGeldin:
                    return "Kişisel masaüstü yapay zekâ asistanın birkaç dakika içinde hazır olacak. Kurulum bitince Fuber AI kendiliğinden açılır.";
                case Ekran.UygulamaAcik:
                    return "Kurulumun sürmesi için uygulamanın kapanması gerekiyor. Sohbetlerin, hafızan ve ayarların olduğu gibi korunur.";
                case Ekran.Kapatiliyor:
                    return "Bir saniye; ardından kurulum kendiliğinden başlar.";
                case Ekran.Kuruluyor:
                    return yukseltme
                        ? "Önceki sürümün yerine kuruluyor; sohbetlerin, hafızan ve ayarların yerinde kalır."
                        : "Birkaç dakika sürebilir. Bu sırada bilgisayarını kullanmaya devam edebilirsin.";
                case Ekran.Hazir:
                    return "Kurulum tamamlandı. İlk açılışta Fuber seni kısa bir tanışmayla karşılayacak.";
                default:
                    return hata != null ? hata.Metin : "";
            }
        }

        string DurumMetni()
        {
            if (ekran == Ekran.Kapatiliyor) return "Uygulama kapatılıyor…";
            if (ekran == Ekran.Hazir) return "Kurulum tamamlandı";
            switch (durumAsama)
            {
                case 0: return "Kurulum paketi hazırlanıyor…";
                case 1: return yukseltme ? "Önceki sürüm güncelleniyor…" : "Kurulum başlıyor…";
                case 2: return "Dosyalar yerleştiriliyor…";
                default: return "Kısayollar ve son ayarlar…";
            }
        }

        int AdimNo()
        {
            switch (ekran)
            {
                case Ekran.HosGeldin:
                case Ekran.UygulamaAcik: return 1;
                case Ekran.Kapatiliyor:
                case Ekran.Kuruluyor: return 2;
                case Ekran.Hazir: return 3;
                default: return 0;
            }
        }

        string AdimEtiketi()
        {
            switch (AdimNo())
            {
                case 1: return "Hoş geldin";
                case 2: return "Kurulum";
                default: return "Hazır";
            }
        }

        string[] CipMetinleri()
        {
            long mb = bilgi.Boyut > 0 ? (long)Math.Ceiling(bilgi.Boyut / 1048576.0 / 100.0) * 100 : 600;
            return new[] { "Windows 10 21H2+ · 11", "64 bit", "~" + mb + " MB" };
        }

        // ── Çizim ────────────────────────────────────────────────────────────────────────────────────────────────────

        static void Ayarla(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        }

        /// <summary>Düğme yerlerini (tıklama alanı) çizmeden hesaplar.</summary>
        void Yerlestir()
        {
            using (var bmp = new Bitmap(1, 1))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                Ayarla(g);
                Duzen(g, Katman.Yok);
            }
        }

        protected override void OnPaint(PaintEventArgs e) { Ciz(e.Graphics); }

        /// <summary>
        /// Kare: sahne (önbellek) → nabız ışığı → F işareti (önbellek) → ekranın sabit yazıları (geçiş bitince önbellek) → değişen parçalar.
        /// Önbellekler fiziksel pikseldir ve açık boyutla çizilir (DrawImageUnscaled DPI'a göre büyütürdü).
        /// </summary>
        void Ciz(Graphics g)
        {
            int w = ClientSize.Width, h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            if (zemin == null || zemin.Width != w || zemin.Height != h) { OnbellekSil(); zemin = ZeminCiz(w, h); }
            if (isaret == null)
                isaret = Isaret.Hazirla(fIsareti, fIsaretiOran, (int)Math.Round(ISARET_BOY * olcek), (int)Math.Round(ISARET_PAY * olcek), 0.12f);
            g.CompositingMode = CompositingMode.SourceCopy;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.DrawImage(zemin, new Rectangle(0, 0, w, h));
            g.CompositingMode = CompositingMode.SourceOver;
            IsaretCiz(g);
            bool onbellekli = GirisOrani() >= 1 && denetim == null && !metinsiz;
            if (onbellekli)
            {
                if (icerik == null || icerikAnahtar != ekranSayaci || icerik.Width != w || icerik.Height != h)
                {
                    if (icerik != null) icerik.Dispose();
                    icerik = IcerikKatmani(w, h);
                    icerikAnahtar = ekranSayaci;
                }
                g.DrawImage(icerik, new Rectangle(0, 0, w, h));
            }
            Ayarla(g);
            g.ScaleTransform(olcek, olcek);
            Katman k = onbellekli ? Katman.Degisken : Katman.Hepsi;
            Duzen(g, k);
            Alt(g, k);
            DugmeCiz(g, dKucult, 1);
            if (dKapat.Gorunur) DugmeCiz(g, dKapat, 1);
        }

        Bitmap IcerikKatmani(int w, int h)
        {
            var bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                Ayarla(g);
                g.ScaleTransform(olcek, olcek);
                Duzen(g, Katman.Sabit);
                Alt(g, Katman.Sabit);
            }
            return bmp;
        }

        Bitmap ZeminCiz(int w, int h)
        {
            float o = olcek;
            var pf = new RectangleF(CERCEVE * o, CERCEVE * o, (EN - 2 * CERCEVE) * o, (BOY - 2 * CERCEVE) * o);
            Bitmap bmp;
            using (GraphicsPath p = Sekil.Yuvarlak(pf, PANO_YC * o))
            {
                var isiklar = new[]
                {
                    // tasarim.css --pano-zemin: alttan soğuk ışık (64% 50% at 50% 108%) + üstten beyaz pus (90% 40% at 50% -10%).
                    new IsikKaynagi(pf.X + pf.Width / 2f, pf.Bottom + pf.Height * 0.08f, pf.Width * 0.64f, pf.Height * 0.5f, Renk.AltIsik,
                        new[] { 0f, 0.4f, 0.7f }, new[] { 0.12f, 0.04f, 0f }),
                    new IsikKaynagi(pf.X + pf.Width / 2f, pf.Y - pf.Height * 0.10f, pf.Width * 0.9f, pf.Height * 0.4f, Color.White,
                        new[] { 0f, 0.64f }, new[] { 0.05f, 0f }),
                    // F işaretinin arkasındaki taban ışık; nabız bunun üstüne eklenir.
                    new IsikKaynagi(IsaretMerkez.X * o, IsaretMerkez.Y * o, HALE * o, HALE * o, Renk.YeniIsik,
                        new[] { 0f, 0.45f, 1f }, new[] { 0.06f, 0.024f, 0f }),
                };
                bmp = Isik.Sahne(w, h, p, Renk.Pano, isiklar);
            }
            using (Graphics g = Graphics.FromImage(bmp))
            {
                Ayarla(g);
                g.ScaleTransform(o, o);
                var pano = new RectangleF(CERCEVE, CERCEVE, EN - 2 * CERCEVE, BOY - 2 * CERCEVE);
                using (GraphicsPath p = Sekil.Yuvarlak(new RectangleF(pano.X + 0.5f, pano.Y + 0.5f, pano.Width - 1f, pano.Height - 1f), PANO_YC - 0.5f))
                using (var k = new Pen(Renk.Beyaz(0.09), 1f)) g.DrawPath(k, p);

                // Çentik: çerçeveden (siyah) panoya oyulur; içinde beyaz FUBER kelime markası.
                float logoEn = logo != null ? LOGO_BOY * logoOran : 62f;
                float govde = Math.Max(120f, logoEn + 44f);
                float xs = (EN - govde) / 2f, xd = xs + govde;
                using (GraphicsPath c = Sekil.Centik(xs, xd, CERCEVE - 1f, CENTIK_BOY + 1f, CENTIK_OMUZ))
                using (var f = new SolidBrush(Renk.Bg)) g.FillPath(f, c);
                LogoCiz(g, (EN - logoEn) / 2f, CERCEVE + (CENTIK_BOY - LOGO_BOY) / 2f - 1f);
            }
            return bmp;
        }

        void LogoCiz(Graphics g, float x, float y)
        {
            if (logo != null)
            {
                using (var kopya = (GraphicsPath)logo.Clone())
                using (var m = new Matrix())
                {
                    m.Translate(x, y);
                    m.Scale(LOGO_BOY, LOGO_BOY);
                    kopya.Transform(m);
                    using (var f = new SolidBrush(Renk.Ink)) g.FillPath(f, kopya);
                }
                return;
            }
            // Yedek: kaynak yoksa düz yazı (Segoe UI).
            using (var f = new SolidBrush(Renk.Ink)) g.DrawString("FUBER", fRozet, f, x, y - 2f, Yazi.Bicim);
        }

        /// <summary>
        /// F işareti (fiziksel px, önbellek): kurulurken arkasında nefes alan ışık (nabız), hazır olunca ışık yerleşir; hata ekranında işaret
        /// geri çekilir (yazıyla yarışmaz). Kare başına yalnız iki hazır bitmap çizilir (eski bütçe).
        /// </summary>
        void IsaretCiz(Graphics g)
        {
            double t = Simdi();
            double nabiz = 0;
            if (ekran == Ekran.Kuruluyor || ekran == Ekran.Kapatiliyor) nabiz = 0.5 - 0.5 * Math.Cos(2 * Math.PI * (t - ekranBas) / 3.2);
            else if (ekran == Ekran.Hazir) nabiz = Math.Min(1, (t - ekranBas) / 0.6);
            float mx = IsaretMerkez.X * olcek, my = IsaretMerkez.Y * olcek;
            Bitmap n = Nabiz(nabiz);
            if (n != null) g.DrawImage(n, new Rectangle((int)Math.Round(mx - n.Width / 2f), (int)Math.Round(my - n.Height / 2f), n.Width, n.Height));
            if (isaret == null)
            {
                // Yedek: kaynak çözülemezse büyük FUBER kelime markası (aynı yerde, düz beyaz).
                if (logo == null) return;
                float lb = 28f * olcek, le = lb * logoOran;
                using (var kopya = (GraphicsPath)logo.Clone())
                using (var m = new Matrix())
                {
                    m.Translate(mx - le / 2f, my - lb / 2f);
                    m.Scale(lb, lb);
                    kopya.Transform(m);
                    var eski = g.SmoothingMode;
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    using (var f = new SolidBrush(ekran == Ekran.Hata ? Renk.Beyaz(0.3) : Renk.Ink)) g.FillPath(f, kopya);
                    g.SmoothingMode = eski;
                }
                return;
            }
            // Tam piksele oturtulur (önbellek fiziksel px; ölçeklenmez → keskin).
            var r = new Rectangle((int)Math.Round(mx - isaret.Width / 2f), (int)Math.Round(my - isaret.Height / 2f), isaret.Width, isaret.Height);
            if (ekran == Ekran.Hata)
            {
                using (var ia = new ImageAttributes())
                {
                    var cm = new ColorMatrix();
                    cm.Matrix33 = 0.3f;
                    ia.SetColorMatrix(cm);
                    g.DrawImage(isaret, r, 0, 0, isaret.Width, isaret.Height, GraphicsUnit.Pixel, ia);
                }
            }
            else g.DrawImage(isaret, r);
        }

        /// <summary>Nabız ışığı, NABIZ_DUZEY düzeyde önceden çizilir (kare başına alfa hesabı yok; düzey farkı gözle seçilmez).</summary>
        Bitmap Nabiz(double k)
        {
            int d = (int)Math.Round(Math.Max(0, Math.Min(1, k)) * (NABIZ_DUZEY - 1));
            if (d <= 0) return null;
            if (nabizlar[d] == null)
                nabizlar[d] = Isik.Leke((int)Math.Round(2 * HALE * olcek), Renk.YeniIsik, new[] { 0f, 0.4f, 1f }, new[] { 0.12f, 0.045f, 0f },
                    d / (float)(NABIZ_DUZEY - 1));
            return nabizlar[d];
        }

        void Duzen(Graphics g, Katman k)
        {
            float h = Akis(g, 0f, Katman.Yok);
            Akis(g, (float)Math.Round(ICERIK_MERKEZ - h / 2f), k);
        }

        /// <summary>İçerik sütunu yukarıdan aşağı: işaret (adım çubuğu / hata rozeti), başlık, açıklama, ekrana özgü blok.</summary>
        float Akis(Graphics g, float y, Katman k)
        {
            bool sabit = k == Katman.Hepsi || k == Katman.Sabit;
            bool degisken = k == Katman.Hepsi || k == Katman.Degisken;
            double ia = GirisOrani();
            float kay = (float)(10 * (1 - ia));
            float bas = y;
            if (ekran == Ekran.Hata) y += Rozet(g, y + kay, sabit, ia) + 18f;
            else y += Adimlar(g, y + kay, sabit, ia) + 20f;

            // Uzun başlık (ör. hata ekranları) F işaretine taşmasın: BASLIK_EN'de satır kırılır.
            List<string> baslik = Yazi.Sar(g, BaslikMetni(), fBaslik, BASLIK_EN);
            foreach (string satir in baslik)
            {
                if (sabit) BaslikCiz(g, satir, SOL, y + kay, ia);
                y += 36f; // satır aralığı 1,2
            }
            y += 4f + 8f;

            foreach (string satir in Yazi.Sar(g, AciklamaMetni(), fAciklama, SUTUN))
            {
                if (sabit) Yaz(g, satir, fAciklama, Renk.Carp(Renk.Ink3, ia), SOL, Yazi.OrtaY(fAciklama, y + kay, 22f));
                y += 22f;
            }

            switch (ekran)
            {
                case Ekran.HosGeldin:
                    y += 22f;
                    y += Cipler(g, y + kay, sabit, ia);
                    y += 30f;
                    y += DugmeSirasi(g, y + kay, degisken, ia);
                    break;
                case Ekran.UygulamaAcik:
                    y += 30f;
                    y += DugmeSirasi(g, y + kay, degisken, ia);
                    break;
                case Ekran.Kapatiliyor:
                case Ekran.Kuruluyor:
                case Ekran.Hazir:
                    y += 30f;
                    y += IlerlemeBlok(g, y + (devam ? 0 : kay), degisken, devam ? 1 : ia);
                    break;
                case Ekran.Hata:
                    if (hata != null && !string.IsNullOrEmpty(hata.Ayrinti))
                    {
                        y += 12f;
                        foreach (string satir in Yazi.Sar(g, hata.Ayrinti, fKucuk, SUTUN))
                        {
                            if (sabit) Yaz(g, satir, fKucuk, Renk.Carp(Renk.Ink4, ia), SOL, Yazi.OrtaY(fKucuk, y + kay, 18f));
                            y += 18f;
                        }
                    }
                    y += 28f;
                    y += DugmeSirasi(g, y + kay, degisken, ia);
                    break;
            }
            return y - bas;
        }

        double GirisOrani()
        {
            if (onizleme) return 1;
            double k = (Simdi() - ekranBas) / 0.42;
            if (k >= 1) return 1;
            if (k <= 0) return 0;
            return 1 - Math.Pow(1 - k, 3);
        }

        float Adimlar(Graphics g, float y, bool ciz, double ia)
        {
            if (!ciz) return 16f;
            int adim = AdimNo();
            for (int i = 0; i < 3; i++)
                using (GraphicsPath p = Sekil.Hap(new RectangleF(SOL + i * 30f, y + 6.5f, 24f, 3f)))
                using (var f = new SolidBrush(i < adim ? Renk.Carp(Renk.Ink, ia) : Renk.Beyaz(0.16 * ia)))
                    g.FillPath(f, p);
            Yaz(g, AdimEtiketi(), fKucuk, Renk.Carp(Renk.Ink3, ia), SOL + 3 * 30f + 6f, Yazi.OrtaY(fKucuk, y, 16f));
            return 16f;
        }

        float Rozet(Graphics g, float y, bool ciz, double ia)
        {
            if (!ciz || hata == null) return 24f;
            string m = hata.Rozet;
            Color yazi = hata.Olumlu ? Renk.YaziBasari : Renk.YaziHata;
            Color ton = hata.Olumlu ? Renk.Yesil : Renk.Kirmizi;
            float w = Yazi.En(g, m, fRozet) + 32f;
            var r = new RectangleF(SOL, y, w, 24f);
            using (GraphicsPath p = Sekil.Hap(r))
            using (var f = new SolidBrush(Color.FromArgb(Renk.Bayt(0.14 * ia), ton))) g.FillPath(f, p);
            using (GraphicsPath p = Sekil.Hap(new RectangleF(r.X + 0.5f, r.Y + 0.5f, r.Width - 1f, r.Height - 1f)))
            using (var k = new Pen(Color.FromArgb(Renk.Bayt(0.30 * ia), ton), 1f)) g.DrawPath(k, p);
            using (var f = new SolidBrush(Renk.Carp(yazi, ia))) g.FillEllipse(f, SOL + 11f, y + 9f, 6f, 6f);
            Yaz(g, m, fRozet, Renk.Carp(yazi, ia), SOL + 22f, Yazi.OrtaY(fRozet, y, 24f));
            return 24f;
        }

        void BaslikCiz(Graphics g, string m, float x, float y, double ia)
        {
            float ty = Yazi.OrtaY(fBaslik, y, 40f);
            if (denetim != null)
                denetim.Add(new MetinKaydi { Metin = m, Px = fBaslik.Size, Renk = Renk.Gumus1, Alan = new RectangleF(x, ty, Yazi.En(g, m, fBaslik), fBaslik.Size * 1.3f) });
            if (metinsiz) return;
            using (var yol = new GraphicsPath())
            {
                // Gümüş-beyaz başlık (tasarim.css --gumus: soldan sağa #b9bdcd → #dfe4ee).
                yol.AddString(m, fBaslik.FontFamily, (int)fBaslik.Style, fBaslik.Size, new PointF(x, ty), Yazi.Bicim);
                RectangleF s0 = yol.GetBounds();
                using (var f = new LinearGradientBrush(new RectangleF(s0.X - 1, s0.Y - 1, s0.Width + 2, s0.Height + 2),
                    Renk.Carp(Renk.Gumus1, ia), Renk.Carp(Renk.Gumus2, ia), LinearGradientMode.Horizontal))
                    g.FillPath(f, yol);
            }
        }

        void Yaz(Graphics g, string m, Font f, Color c, float x, float y)
        {
            if (string.IsNullOrEmpty(m)) return;
            if (denetim != null) denetim.Add(new MetinKaydi { Metin = m, Px = f.Size, Renk = c, Alan = new RectangleF(x, y, Yazi.En(g, m, f), f.Size * 1.3f) });
            if (metinsiz) return;
            using (var b = new SolidBrush(c)) g.DrawString(m, f, b, x, y, Yazi.Bicim);
        }

        float Cipler(Graphics g, float y, bool ciz, double ia)
        {
            float x = SOL;
            foreach (string c in CipMetinleri())
            {
                float w = (float)Math.Ceiling(Yazi.En(g, c, fKucuk)) + 22f;
                if (ciz)
                {
                    var r = new RectangleF(x, y, w, 26f);
                    using (GraphicsPath p = Sekil.Hap(r))
                    using (var f = new SolidBrush(Renk.Beyaz(0.045 * ia))) g.FillPath(f, p);
                    using (GraphicsPath p = Sekil.Hap(new RectangleF(r.X + 0.5f, r.Y + 0.5f, r.Width - 1f, r.Height - 1f)))
                    using (var k = new Pen(Renk.Beyaz(0.10 * ia), 1f)) g.DrawPath(k, p);
                    Yaz(g, c, fKucuk, Renk.Carp(Renk.Ink2, ia), x + 11f, Yazi.OrtaY(fKucuk, y, 26f));
                }
                x += w + 8f;
            }
            return 26f;
        }

        float DugmeSirasi(Graphics g, float y, bool ciz, double ia)
        {
            float x = SOL;
            bool vardi = false;
            foreach (Dugme d in dugmeler)
            {
                if (d.Simge || !d.Gorunur) continue;
                float w = Math.Max(d.Tur == DugmeTuru.Beyaz ? 128f : 104f, (float)Math.Ceiling(Yazi.En(g, d.Metin, fDugme)) + 48f);
                d.Alan = new RectangleF(x, y, w, 40f);
                if (ciz) DugmeCiz(g, d, ia);
                x += w + 10f;
                vardi = true;
            }
            return vardi ? 40f : 0f;
        }

        void DugmeCiz(Graphics g, Dugme d, double ia)
        {
            bool ust = d == uzerinde, bas = ust && d == basili;
            RectangleF r = d.Alan;
            if (bas) r.Inflate(-r.Width * 0.015f, -r.Height * 0.03f);
            if (d.Simge) SimgeCiz(g, d, r, ust);
            else
            {
                if (d.Tur == DugmeTuru.Beyaz)
                {
                    // Altından yumuşak beyaz ışık (tasarim.css .dgm--beyaz: 0 10px 30px -10px ters-golge): bir kez çizilen
                    // yuvarlak ışık lekesi düğmenin altına elips olarak gerilir.
                    if (parilti == null) parilti = Isik.Leke(96, Color.White, new[] { 0f, 0.45f, 1f }, new[] { 1f, 0.32f, 0f }, 1f);
                    using (var ia2 = new ImageAttributes())
                    {
                        var cm = new ColorMatrix();
                        cm.Matrix33 = (float)((ust ? 0.24 : 0.15) * ia);
                        ia2.SetColorMatrix(cm);
                        float gx = r.X - r.Width * 0.06f, gy = r.Y + r.Height * 0.3f, gw = r.Width * 1.12f, gh = r.Height * 1.25f;
                        g.DrawImage(parilti, new[] { new PointF(gx, gy), new PointF(gx + gw, gy), new PointF(gx, gy + gh) },
                            new RectangleF(0, 0, parilti.Width, parilti.Height), GraphicsUnit.Pixel, ia2);
                    }
                    using (GraphicsPath p = Sekil.Hap(r))
                    using (var f = new SolidBrush(Renk.Carp(ust ? Renk.Hex(0xf2f3f6) : Renk.Ink, ia))) g.FillPath(f, p);
                }
                else
                {
                    using (GraphicsPath p = Sekil.Hap(r))
                    using (var f = new SolidBrush(Renk.Carp(ust ? Renk.Dugme2Ust : Renk.Dugme2, ia))) g.FillPath(f, p);
                    using (GraphicsPath p = Sekil.Hap(new RectangleF(r.X + 0.5f, r.Y + 0.5f, r.Width - 1f, r.Height - 1f)))
                    using (var k = new Pen(Renk.Beyaz(0.08 * ia), 1f)) g.DrawPath(k, p);
                }
                Color yc = d.Tur == DugmeTuru.Beyaz ? Renk.Carp(Color.Black, ia) : Renk.Carp(Renk.Metin, ia);
                float w = Yazi.En(g, d.Metin, fDugme);
                Yaz(g, d.Metin, fDugme, yc, r.X + (r.Width - w) / 2f, Yazi.OrtaY(fDugme, r.Y, r.Height));
            }
            if (klavyeOdak && odak >= 0)
            {
                List<Dugme> l = GorunurDugmeler();
                if (odak < l.Count && l[odak] == d)
                {
                    RectangleF o = d.Alan;
                    o.Inflate(3f, 3f);
                    using (GraphicsPath p = d.Simge ? Daire(o) : Sekil.Hap(o))
                    using (var k = new Pen(Renk.Beyaz(0.6 * ia), 1.5f)) g.DrawPath(k, p);
                }
            }
        }

        static GraphicsPath Daire(RectangleF r)
        {
            var p = new GraphicsPath();
            p.AddEllipse(r);
            return p;
        }

        void SimgeCiz(Graphics g, Dugme d, RectangleF r, bool ust)
        {
            if (ust) using (var f = new SolidBrush(Renk.Beyaz(0.08))) g.FillEllipse(f, r);
            float cx = r.X + r.Width / 2f, cy = r.Y + r.Height / 2f;
            using (var k = new Pen(ust ? Renk.Ink : Renk.Ink3, 1.4f))
            {
                k.StartCap = LineCap.Round;
                k.EndCap = LineCap.Round;
                if (d.Tur == DugmeTuru.Kucult) g.DrawLine(k, cx - 5f, cy, cx + 5f, cy);
                else
                {
                    g.DrawLine(k, cx - 4.5f, cy - 4.5f, cx + 4.5f, cy + 4.5f);
                    g.DrawLine(k, cx + 4.5f, cy - 4.5f, cx - 4.5f, cy + 4.5f);
                }
            }
        }

        float IlerlemeBlok(Graphics g, float y, bool ciz, double ia)
        {
            if (ciz)
            {
                IlerlemeCiz(g, new RectangleF(SOL, y, SUTUN, 4f), ia);
                float sy = y + 16f;
                Yaz(g, DurumMetni(), fDurum, Renk.Carp(Renk.Ink2, ia), SOL, Yazi.OrtaY(fDurum, sy, 18f));
                if (ekran != Ekran.Kapatiliyor)
                {
                    string yuzde = "%" + ((int)Math.Floor(gosterilen * 100 + 1e-6)).ToString(CultureInfo.InvariantCulture);
                    float w = Yazi.En(g, yuzde, fDurum);
                    Yaz(g, yuzde, fDurum, Renk.Carp(Renk.Ink3, ia), SOL + SUTUN - w, Yazi.OrtaY(fDurum, sy, 18f));
                }
            }
            return 4f + 12f + 18f;
        }

        static void YatayIsikDoldur(Graphics g, RectangleF r, double tepe)
        {
            using (var f = new LinearGradientBrush(new RectangleF(r.X - 1, r.Y, r.Width + 2, r.Height), Color.Transparent, Color.Transparent, LinearGradientMode.Horizontal))
            {
                var cb = new ColorBlend(3);
                cb.Colors = new[] { Renk.Beyaz(0), Renk.Beyaz(tepe), Renk.Beyaz(0) };
                cb.Positions = new[] { 0f, 0.5f, 1f };
                f.InterpolationColors = cb;
                g.FillRectangle(f, r);
            }
        }

        void IlerlemeCiz(Graphics g, RectangleF r, double ia)
        {
            double t = Simdi();
            using (GraphicsPath iz = Sekil.Hap(r))
            using (var f = new SolidBrush(Renk.Beyaz(0.10 * ia))) g.FillPath(f, iz);
            if (ekran == Ekran.Kapatiliyor)
            {
                // Belirsiz: bir ışık parçası iz boyunca yumuşakça gidip gelir.
                float pw = r.Width * 0.3f;
                double k = 0.5 - 0.5 * Math.Cos(2 * Math.PI * (t - ekranBas) / 1.8);
                var pr = new RectangleF(r.X + (float)((r.Width - pw) * k), r.Y, pw, r.Height);
                GraphicsState st0 = g.Save();
                using (GraphicsPath iz = Sekil.Hap(r)) g.SetClip(iz, CombineMode.Intersect);
                YatayIsikDoldur(g, pr, 0.95 * ia);
                g.Restore(st0);
                return;
            }
            float w = (float)(r.Width * Math.Max(0, Math.Min(1, gosterilen)));
            if (w < 0.5f) return;
            if (w < r.Height) w = r.Height;
            var dolu = new RectangleF(r.X, r.Y, w, r.Height);
            // Baş ışığı: dolan ucun çevresinde küçük soğuk parıltı.
            Sekil.RadyalIsik(g, new PointF(dolu.Right - 1.5f, r.Y + r.Height / 2f), 13f, 6f, Renk.YeniIsik,
                new[] { 0f, 0.5f, 1f }, new[] { (float)(0.34 * ia), (float)(0.1 * ia), 0f });
            using (GraphicsPath p = Sekil.Hap(dolu))
            {
                using (var f = new LinearGradientBrush(new RectangleF(dolu.X - 1, dolu.Y, Math.Max(dolu.Width, 8f) + 2, dolu.Height),
                    Renk.Carp(Renk.Gumus1, 0.5 * ia), Renk.Carp(Renk.Ink, ia), LinearGradientMode.Horizontal))
                    g.FillPath(f, p);
                if (ekran == Ekran.Kuruluyor)
                {
                    // Dolu kısımda soldan sağa süzülen ışık.
                    double d = ((t - ekranBas) % 1.9) / 1.9;
                    float bw = 80f;
                    var br = new RectangleF(dolu.X - bw + (float)((dolu.Width + bw) * d), dolu.Y, bw, dolu.Height);
                    GraphicsState st = g.Save();
                    g.SetClip(p, CombineMode.Intersect);
                    YatayIsikDoldur(g, br, 0.85 * ia);
                    g.Restore(st);
                }
            }
        }

        void Alt(Graphics g, Katman k)
        {
            float y = BOY - CERCEVE - 40f;
            if (k == Katman.Hepsi || k == Katman.Sabit)
            {
                using (var f = new SolidBrush(Renk.Mavi2)) g.FillEllipse(f, SOL, y + 6f, 6f, 6f);
                Yaz(g, "Önizleme sürümü · " + bilgi.Surum, fKucuk, Renk.Ink3, SOL + 14f, Yazi.OrtaY(fKucuk, y, 18f));
            }
            if (k == Katman.Sabit) return;
            if (not != null && Simdi() < notBitis)
            {
                float w = Yazi.En(g, not, fKucuk);
                Yaz(g, not, fKucuk, Renk.Ink2, EN - CERCEVE - 28f - w, Yazi.OrtaY(fKucuk, y, 18f));
            }
        }

        // ── Girdi ────────────────────────────────────────────────────────────────────────────────────────────────────

        List<Dugme> GorunurDugmeler()
        {
            var l = new List<Dugme>();
            foreach (Dugme d in dugmeler) if (d.Gorunur) l.Add(d);
            return l;
        }

        Dugme Birincil()
        {
            foreach (Dugme d in dugmeler) if (d.Gorunur && d.Tur == DugmeTuru.Beyaz) return d;
            return null;
        }

        Dugme DugmeBul(Point p)
        {
            var m = new PointF(p.X / olcek, p.Y / olcek);
            for (int i = dugmeler.Count - 1; i >= 0; i--)
            {
                Dugme d = dugmeler[i];
                if (d.Gorunur && d.Alan.Contains(m)) return d;
            }
            return null;
        }

        protected override bool ProcessDialogKey(Keys k)
        {
            Keys tus = k & Keys.KeyCode;
            if (tus == Keys.Tab || tus == Keys.Right || tus == Keys.Left || tus == Keys.Down || tus == Keys.Up)
            {
                List<Dugme> l = GorunurDugmeler();
                if (l.Count == 0) return true;
                bool geri = (k & Keys.Shift) == Keys.Shift || tus == Keys.Left || tus == Keys.Up;
                odak = odak < 0 ? (geri ? l.Count - 1 : 0) : (odak + (geri ? l.Count - 1 : 1)) % l.Count;
                klavyeOdak = true;
                Invalidate();
                return true;
            }
            if (tus == Keys.Enter || tus == Keys.Space)
            {
                List<Dugme> l = GorunurDugmeler();
                Dugme d = odak >= 0 && odak < l.Count ? l[odak] : Birincil();
                if (d != null) d.Eylem();
                return true;
            }
            if (tus == Keys.Escape) { KapatIstegi(); return true; }
            return base.ProcessDialogKey(k);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            Dugme d = DugmeBul(e.Location);
            if (d != uzerinde)
            {
                uzerinde = d;
                Cursor = d != null ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (uzerinde != null) { uzerinde = null; Invalidate(); }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            Dugme d = DugmeBul(e.Location);
            if (d == null)
            {
                // Boş yerden sürükle (WM_NCLBUTTONDOWN + HTCAPTION).
                ReleaseCapture();
                SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
                return;
            }
            basili = d;
            klavyeOdak = false;
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            Dugme d = basili;
            basili = null;
            Invalidate();
            if (d != null && d == DugmeBul(e.Location)) d.Eylem();
        }

        // ── Rapor (kuru kip) ─────────────────────────────────────────────────────────────────────────────────────────

        void RaporYaz(bool geciciSilindi)
        {
            var j = new StringBuilder("{");
            j.Append("\"ekranlar\":").Append(Json.Dizi(rEkranlar)).Append(',');
            j.Append("\"ilerleme\":[");
            for (int d = 0; d < rIlerleme.Count; d++)
            {
                j.Append(d > 0 ? ",[" : "[");
                List<double> l = rIlerleme[d];
                for (int i = 0; i < l.Count; i++) j.Append(i > 0 ? "," : "").Append(l[i].ToString("0.####", CultureInfo.InvariantCulture));
                j.Append(']');
            }
            j.Append("],");
            j.Append("\"durumlar\":").Append(Json.Dizi(rDurumlar)).Append(',');
            j.Append("\"nsisKodlari\":[").Append(string.Join(",", rNsis)).Append("],");
            j.Append("\"kapatma\":").Append(Json.Metin(rKapatma)).Append(',');
            j.Append("\"hedef\":").Append(Json.Metin(kurucu.Hedef)).Append(',');
            j.Append("\"gecici\":").Append(Json.Metin(kurucu.GeciciKlasor)).Append(',');
            j.Append("\"geciciSilindi\":").Append(geciciSilindi ? "true" : "false").Append(',');
            j.Append("\"uygulama\":").Append(Json.Metin(kurucu.UygulamaYolu)).Append(',');
            j.Append("\"uygulamaAcildi\":").Append(rUygulamaAcildi ? "true" : "false").Append(',');
            j.Append("\"acilis\":").Append(Json.Metin(rAcilis)).Append(',');
            j.Append("\"ikonlar\":").Append(Json.Metin(rIkon)).Append(',');
            j.Append("\"cikisKodu\":").Append(CikisKodu).Append(',');
            j.Append("\"sureMs\":").Append((long)saat.Elapsed.TotalMilliseconds);
            j.Append('}');
            try { File.WriteAllText(s.Rapor, j.ToString(), new UTF8Encoding(false)); }
            catch (Exception e) { kurucu.Gunluk.Yaz("rapor yazılamadı: " + e.Message); }
        }

        // ── Önizleme (--onizleme) ────────────────────────────────────────────────────────────────────────────────────

        public float Olcek { get { return olcek; } }

        public void OnizlemeOlcegi(float o)
        {
            if (!IsHandleCreated) { IntPtr h = Handle; }
            olcek = o;
            ClientSize = new Size((int)Math.Round(EN * o), (int)Math.Round(BOY * o));
            OnbellekSil();
        }

        /// <summary>Bir ekranı dondurulmuş zamanda hazırlar (geçiş bitmiş, canlandırma `zamanSn` anında).</summary>
        public void OnizlemeSahnesi(Ekran e, double ilerleme, int asama, HataBilgisi h, double zamanSn, bool odakli, bool yukselt)
        {
            donukZaman = -1;
            hata = h;
            yukseltme = yukselt;
            klavyeOdak = odakli;
            if (e == Ekran.Hazir) ekran = Ekran.Kuruluyor;
            EkranaGec(e);
            durumAsama = asama;
            hedef = gosterilen = ilerleme;
            ekranBas = 0;
            donukZaman = zamanSn;
            Yerlestir();
        }

        public Bitmap Resim(bool metinsizCiz, List<MetinKaydi> kayit)
        {
            metinsiz = metinsizCiz;
            denetim = kayit;
            var bmp = new Bitmap(ClientSize.Width, ClientSize.Height, PixelFormat.Format32bppArgb);
            try { DrawToBitmap(bmp, new Rectangle(Point.Empty, ClientSize)); }
            finally { metinsiz = false; denetim = null; }
            return bmp;
        }

        public List<Dugme> Dugmeler { get { return GorunurDugmeler(); } }

        /// <summary>Kuruluyor ekranının bir karesinin ortalama çizim süresi (ms).</summary>
        public double KareSuresi(int n)
        {
            using (var bmp = new Bitmap(ClientSize.Width, ClientSize.Height, PixelFormat.Format32bppArgb))
            {
                var alan = new Rectangle(Point.Empty, ClientSize);
                DrawToBitmap(bmp, alan);
                var sw = Stopwatch.StartNew();
                for (int i = 0; i < n; i++) { donukZaman += 1 / 60.0; DrawToBitmap(bmp, alan); }
                return sw.Elapsed.TotalMilliseconds / n;
            }
        }
    }
}
