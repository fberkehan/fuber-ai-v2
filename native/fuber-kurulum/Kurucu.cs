// Kurulum başlatıcısının işçisi (Görev 17, K8): ön koşullar, açık uygulamayı kapatma, gömülü NSIS paketini AKIŞLA çıkarma
// (~176 MB; belleğe bir kerede alınmaz), sessiz kurulum (/S /D=<hedef>), hedef klasör boyutundan ilerleme, uygulamayı açma, günlük.
// Arayüz iş parçacığına dokunmaz; Pencere bildirimleri kendi iş parçacığına taşır.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using IPersistFile = System.Runtime.InteropServices.ComTypes.IPersistFile;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace FuberKurulum
{
    /// <summary>Derlemede gömülen ürün bilgisi (bilgi.txt: anahtar=değer) + paketin varlığı.</summary>
    internal sealed class Bilgi
    {
        public string Surum = "geliştirme";
        public string Guid = "";
        public string Urun = "Fuber AI";
        public string Exe = "Fuber AI.exe";
        public string Klasor = "Fuber AI";
        public long Boyut;      // kurulu uygulamanın boyutu (release/win-unpacked), bayt
        public bool PaketVar;
        public long PaketBoyut;

        public static Bilgi Oku()
        {
            var b = new Bilgi();
            string m = Kaynak.Metin("bilgi.txt");
            if (m != null)
            {
                foreach (string satir in m.Replace("\r", "").Split('\n'))
                {
                    int e = satir.IndexOf('=');
                    if (e <= 0) continue;
                    string k = satir.Substring(0, e).Trim(), v = satir.Substring(e + 1).Trim();
                    switch (k)
                    {
                        case "surum": b.Surum = v; break;
                        case "guid": b.Guid = v; break;
                        case "urun": b.Urun = v; break;
                        case "exe": b.Exe = v; break;
                        case "klasor": b.Klasor = v; break;
                        case "boyut": long.TryParse(v, out b.Boyut); break;
                    }
                }
            }
            using (Stream p = Kaynak.Ac("paket.exe"))
            {
                b.PaketVar = p != null;
                if (p != null) b.PaketBoyut = p.Length;
            }
            return b;
        }
    }

    /// <summary>Hata ekranının içeriği. Metinler kullanıcı içindir; ayrıntı küçük satırda ve günlükte.</summary>
    internal sealed class HataBilgisi
    {
        public string Baslik, Metin, Ayrinti;
        public string Rozet = "Kurulum durdu";
        public bool Olumlu;
        public bool Tekrar = true;
        public int CikisKodu = 2;

        public static HataBilgisi Nsis(int kod, string gunluk)
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum tamamlanamadı",
                Metin = "Dosyalar yerleştirilirken bir sorun çıktı. Bir kez daha denemek çoğu zaman çözer; sürerse günlük dosyasını bize gönder.",
                Ayrinti = "Hata kodu " + kod + " · Günlük: " + gunluk,
            };
        }
        public static HataBilgisi Paket(string neden, string gunluk)
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum paketi açılamadı",
                Metin = "Geçici klasöre yazılamadı. Diskte biraz yer açıp yeniden dene.",
                Ayrinti = neden + "\nGünlük: " + gunluk,
            };
        }
        public static HataBilgisi PaketYok()
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum paketi bulunamadı",
                Metin = "Bu bir geliştirme derlemesi; içinde kurulacak paket yok. npm run dist ile üretilen kurulum dosyasını kullan.",
                Tekrar = false,
            };
        }
        public static HataBilgisi Disk(string surucu, long gerekli, long bos)
        {
            return new HataBilgisi
            {
                Baslik = "Yeterli boş alan yok",
                Metin = surucu + " sürücüsünde en az " + Boyut(gerekli) + " boş alan gerekiyor, şu an " + Boyut(bos)
                    + " var. Biraz yer açıp yeniden dene.",
            };
        }
        public static HataBilgisi EskiWindows(string surum)
        {
            return new HataBilgisi
            {
                Baslik = "Bu Windows sürümü desteklenmiyor",
                Metin = "Fuber AI, Windows 10'un 21H2 sürümünü (derleme 19044) ya da Windows 11'i ister. Windows Update ile güncelleyip yeniden dene.",
                Ayrinti = "Bu bilgisayar: Windows " + surum,
                Tekrar = false,
            };
        }
        public static HataBilgisi Kapatilamadi(string gunluk)
        {
            return new HataBilgisi
            {
                Baslik = "Fuber AI kapatılamadı",
                Metin = "Uygulamayı görev çubuğunun sağındaki Fuber simgesinden kapatıp yeniden dene.",
                Ayrinti = "Günlük: " + gunluk,
            };
        }
        public static HataBilgisi ExeYok(string yol)
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum doğrulanamadı",
                Metin = "Kurulum bitti ama Fuber AI dosyası bulunamadı. Bir kez daha denemek çoğu zaman çözer.",
                Ayrinti = yol,
            };
        }
        public static HataBilgisi Acilamadi(string neden)
        {
            return new HataBilgisi
            {
                Baslik = "Fuber AI kuruldu",
                Metin = "Uygulama kendiliğinden açılamadı. Başlat menüsünden ya da masaüstündeki Fuber AI kısayolundan açabilirsin.",
                Ayrinti = neden,
                Rozet = "Kurulum tamamlandı",
                Olumlu = true,
                Tekrar = false,
                CikisKodu = 3,
            };
        }
        public static HataBilgisi Beklenmeyen(string neden, string gunluk)
        {
            return new HataBilgisi
            {
                Baslik = "Beklenmeyen bir sorun çıktı",
                Metin = "Kurulum yarıda kaldı. Bir kez daha denemek çoğu zaman çözer; sürerse günlük dosyasını bize gönder.",
                Ayrinti = neden + "\nGünlük: " + gunluk,
            };
        }
        /// <summary>Paket çıkarıldı ama çalıştırılamadı (çoğunlukla virüs koruması engeller ya da siler).</summary>
        public static HataBilgisi Baslatilamadi(string neden, string gunluk)
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum paketi başlatılamadı",
                Metin = "Windows ya da virüs koruması paketi engellemiş olabilir. Windows Güvenliği'nde Koruma geçmişine bakıp yeniden dene.",
                Ayrinti = neden + "\nGünlük: " + gunluk,
            };
        }
        public static HataBilgisi SurumUyusmuyor(string kurulu, string beklenen, string gunluk)
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum doğrulanamadı",
                Metin = "Kurulum bitti ama yerleşen Fuber AI beklenen sürüm değil. Bir kez daha denemek çoğu zaman çözer; sürerse günlüğü bize gönder.",
                Ayrinti = "Kurulu " + kurulu + ", beklenen " + beklenen + "\nGünlük: " + gunluk,
            };
        }
        public static HataBilgisi MakineKurulumu(string yol)
        {
            return new HataBilgisi
            {
                Baslik = "Eski Fuber AI tüm kullanıcılara kurulu",
                Metin = "İkinci bir kopya kurmamak için önce Ayarlar › Uygulamalar'dan eski Fuber AI'ı kaldır, sonra Tekrar dene'ye bas.",
                Ayrinti = yol,
            };
        }
        public static HataBilgisi FarkliHesap()
        {
            return new HataBilgisi
            {
                Baslik = "Kurulum başka bir hesapla açıldı",
                Metin = "Fuber AI senin hesabına kurulur. Kurulum dosyasını yönetici olarak değil, çift tıklayarak aç.",
                Tekrar = false,
            };
        }

        /// <summary>1,2 GB / 312 MB (Türkçe ondalık virgül).</summary>
        public static string Boyut(long bayt)
        {
            var tr = CultureInfo.GetCultureInfo("tr-TR");
            double mb = bayt / 1048576.0;
            if (mb >= 1024) return (mb / 1024).ToString("0.0", tr) + " GB";
            return Math.Max(1, Math.Round(mb)).ToString("0", tr) + " MB";
        }
    }

    internal sealed class KurulumIstisnasi : Exception
    {
        public readonly HataBilgisi Hata;
        public KurulumIstisnasi(HataBilgisi h) : base(h.Baslik) { Hata = h; }
    }

    /// <summary>
    /// Zaman damgalı düz metin günlük (UTF-8). YALNIZ varsayılan yolunda (%TEMP%\Fuber AI Kurulum.log) 1 MB'ı aşınca baştan başlar;
    /// verilen bir yol (--gunluk, yalnız geliştirme derlemesi) asla silinmez, yalnız sonuna eklenir.
    /// </summary>
    internal sealed class Gunluk
    {
        public static readonly string VarsayilanYol = Path.Combine(Path.GetTempPath(), "Fuber AI Kurulum.log");
        readonly string yol;
        readonly object kilit = new object();

        public static Gunluk Ac(string verilen) { return verilen != null ? new Gunluk(verilen, false) : new Gunluk(VarsayilanYol, true); }

        Gunluk(string yol, bool dondur)
        {
            this.yol = yol;
            if (!dondur) return;
            try
            {
                var fi = new FileInfo(yol);
                if (fi.Exists && fi.Length > (1 << 20)) fi.Delete();
            }
            catch { }
        }

        public string Yol { get { return yol; } }

        /// <summary>Hata ekranında gösterilecek kısa biçim (%TEMP% kısaltması).</summary>
        public string KisaYol
        {
            get
            {
                string tmp = Path.GetTempPath().TrimEnd('\\');
                return yol.StartsWith(tmp, StringComparison.OrdinalIgnoreCase) ? "%TEMP%" + yol.Substring(tmp.Length) : yol;
            }
        }

        public void Yaz(string m)
        {
            lock (kilit)
            {
                try
                {
                    File.AppendAllText(yol, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + "  " + m
                        + Environment.NewLine, new UTF8Encoding(false));
                }
                catch { }
            }
        }
    }

    internal delegate void Bildirici(string faz, double oran, long boyut);

    internal sealed class Kurucu
    {
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint bayrak, IntPtr jeton, out IntPtr yol);
        [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);
        [DllImport("ntdll.dll")] static extern int RtlGetVersion(ref OSVERSIONINFOW v);
        [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint erisim, bool miras, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageName(IntPtr p, int bayrak, StringBuilder ad, ref int boyut);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint erisim, out IntPtr jeton);
        delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x0008;
        const int WINDOWS10_21H2 = 19044;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct OSVERSIONINFOW
        {
            public int dwOSVersionInfoSize, dwMajorVersion, dwMinorVersion, dwBuildNumber, dwPlatformId;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szCSDVersion;
        }

        const uint WM_CLOSE = 0x0010;
        static readonly Guid FOLDERID_UserProgramFiles = new Guid("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB");

        readonly Secenekler s;
        readonly Bilgi b;
        public readonly Gunluk Gunluk;
        public readonly string Hedef;
        public string UygulamaYolu;
        string gecici;

        public Kurucu(Secenekler s, Bilgi b)
        {
            this.s = s;
            this.b = b;
            Gunluk = Gunluk.Ac(s.GunlukYolu);
            Hedef = HedefBul();
        }

        public bool Kuru { get { return s.Kuru; } }

        /// <summary>Açık mı diye bakılan süreç adı: gerçekte "Fuber AI"; kuru kipte YALNIZ sahte uygulamanın adı (fuber-sahte-…).</summary>
        public string SurecAdi { get { return Path.GetFileNameWithoutExtension(s.Kuru ? s.SahteUygulama : b.Exe); } }

        /// <summary>
        /// Kapatılabilecek süreçlerin klasörü: gerçekte kurulum yeri (NSIS de yalnız $INSTDIR altındakileri kapatır); kuru kipte sahte
        /// uygulamanın klasörü. Başka yerdeki aynı adlı kopya (geliştirme / taşınabilir) dokunulmaz.
        /// </summary>
        public string UygulamaKlasoru { get { return s.Kuru ? Path.GetDirectoryName(s.SahteUygulama) : Hedef; } }

        /// <summary>Kurulu uygulamanın beklenen boyutu (ilerleme ve disk denetimi); bilinmiyorsa 0.</summary>
        public long BeklenenBoyut { get { return s.Kuru ? Math.Max(0, s.Boyut) : b.Boyut; } }

        public string GeciciKlasor { get { return gecici; } }

        string HedefBul()
        {
            if (s.Kuru)
            {
                if (s.Hedef != null) return Path.GetFullPath(s.Hedef).TrimEnd('\\');
                // Elle deneme: her seferinde temiz, başlatıcının kendi geçici hedefi (yalnız bu klasör silinir).
                string deneme = Path.Combine(Path.GetTempPath(), "fuber-kuru-hedef");
                try { if (Directory.Exists(deneme)) Directory.Delete(deneme, true); } catch { }
                return deneme;
            }
            string kayitli = KayitliKonum();
            if (!string.IsNullOrEmpty(kayitli)) return kayitli.TrimEnd('\\');
            return Path.Combine(KullaniciProgramlari(), b.Klasor);
        }

        /// <summary>NSIS'in kayıtlı kurulum yeri (HKCU\Software\{APP_GUID}\InstallLocation): yükseltme aynı yerin üstüne kurar.</summary>
        string KayitliKonum()
        {
            if (s.Kuru || string.IsNullOrEmpty(b.Guid)) return null;
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey("Software\\" + b.Guid))
                    return k == null ? null : k.GetValue("InstallLocation") as string;
            }
            catch { return null; }
        }

        /// <summary>Kullanıcının Programlar klasörü (NSIS ile aynı bilinen klasör; çoğunlukla %LOCALAPPDATA%\Programs).</summary>
        static string KullaniciProgramlari()
        {
            try
            {
                IntPtr p;
                if (SHGetKnownFolderPath(FOLDERID_UserProgramFiles, 0, IntPtr.Zero, out p) == 0)
                {
                    try { return Marshal.PtrToStringUni(p); }
                    finally { CoTaskMemFree(p); }
                }
            }
            catch { }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
        }

        public static string WindowsSurumu(out int ana, out int derleme)
        {
            ana = Environment.OSVersion.Version.Major;
            derleme = Environment.OSVersion.Version.Build;
            try
            {
                var v = new OSVERSIONINFOW();
                v.dwOSVersionInfoSize = Marshal.SizeOf(typeof(OSVERSIONINFOW));
                if (RtlGetVersion(ref v) == 0) { ana = v.dwMajorVersion; derleme = v.dwBuildNumber; }
            }
            catch { }
            return ana + " (derleme " + derleme + ")";
        }

        long PaketBoyutu()
        {
            if (!s.Kuru) return b.PaketBoyut;
            try { return new FileInfo(s.SahtePaket).Length; } catch { return 0; }
        }

        /// <summary>
        /// Kur düğmesinden önce: paket, Windows 10 21H2+ / 11, yönetici olarak başka hesapla açılma, tüm kullanıcılara kurulu eski
        /// sürüm, boş alan. Sorun yoksa null.
        /// </summary>
        public HataBilgisi OnKosullar()
        {
            if (!s.Kuru && !b.PaketVar) return HataBilgisi.PaketYok();
            int ana, derleme;
            string surum = WindowsSurumu(out ana, out derleme);
            if (s.Kuru && s.SahteDerleme > 0) { ana = 10; derleme = s.SahteDerleme; surum = "10 (derleme " + derleme + ", sahte)"; }
            // Windows 11 de ana sürüm 10'dur (derleme ≥ 22000); Windows 10 ancak 21H2 (19044) ve sonrası.
            if (ana < 10 || (ana == 10 && derleme < WINDOWS10_21H2))
            {
                Gunluk.Yaz("Windows desteklenmiyor: " + surum);
                return HataBilgisi.EskiWindows(surum);
            }
            if (Yonetici())
            {
                bool farkli = s.Kuru && s.SahteYonetici != null ? s.SahteYonetici == "farkli" : BaskaHesapMi();
                Gunluk.Yaz("kurulum yönetici olarak açık; kabuğun hesabı " + (farkli ? "FARKLI" : "aynı"));
                if (farkli) return HataBilgisi.FarkliHesap();
            }
            string makine = s.Kuru ? (s.SahteMakine ? "C:\\Program Files\\Fuber AI (sahte)" : null) : MakineKurulumu();
            if (makine != null)
            {
                if (string.IsNullOrEmpty(KayitliKonum()))
                {
                    Gunluk.Yaz("tüm kullanıcılara kurulu eski sürüm var, kullanıcıya özel kurulum yok: " + makine);
                    return HataBilgisi.MakineKurulumu(makine);
                }
                Gunluk.Yaz("tüm kullanıcılara kurulu eski sürüm de var (" + makine + "); kullanıcıya özel kurulum güncelleniyor");
            }
            try
            {
                long paket = PaketBoyutu();
                long mevcut = KlasorBoyutu(Hedef);
                // Kurulu boyut + geçici paket + NSIS'in güncelleyici önbelleğine kopyası + pay; var olan kurulum yerinde değişir.
                long gerekli = Math.Max(0, BeklenenBoyut - mevcut) + paket * 2 + (150L << 20);
                var d = new DriveInfo(Path.GetPathRoot(Hedef));
                if (d.IsReady && d.AvailableFreeSpace < gerekli)
                {
                    Gunluk.Yaz("boş alan yetersiz: " + d.Name + " " + d.AvailableFreeSpace + " < " + gerekli);
                    return HataBilgisi.Disk(d.Name.TrimEnd('\\'), gerekli, d.AvailableFreeSpace);
                }
            }
            catch (Exception e) { Gunluk.Yaz("boş alan denetlenemedi: " + e.Message); }
            return null;
        }

        /// <summary>
        /// Kullanıcının oturumunda, adı SurecAdi olan VE exe'si UygulamaKlasoru altında olan süreçler (bu süreç hariç). Yolu
        /// okunamayan ya da başka yerdeki aynı adlı süreç dokunulmaz. Çağıran Dispose eder.
        /// </summary>
        List<Process> AcikSurecler(bool kaydet)
        {
            var liste = new List<Process>();
            Process ben = Process.GetCurrentProcess();
            int oturum = ben.SessionId, kimlik = ben.Id;
            string kok = Path.GetFullPath(UygulamaKlasoru).TrimEnd('\\') + "\\";
            foreach (Process p in Process.GetProcessesByName(SurecAdi))
            {
                bool al = false;
                try { al = p.SessionId == oturum && p.Id != kimlik; } catch { }
                if (al)
                {
                    string yol = SurecYolu(p.Id);
                    al = yol != null && yol.StartsWith(kok, StringComparison.OrdinalIgnoreCase);
                    if (!al && kaydet) Gunluk.Yaz("aynı adlı süreç kurulum yerinde değil, dokunulmadı: " + p.Id + " " + (yol ?? "(yol okunamadı)"));
                }
                if (al) liste.Add(p); else p.Dispose();
            }
            return liste;
        }

        static string SurecYolu(int pid)
        {
            IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int n = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString(0, n) : null;
            }
            finally { CloseHandle(h); }
        }

        public bool AcikMi() { return AcikMi(false); }

        bool AcikMi(bool kaydet)
        {
            List<Process> l = AcikSurecler(kaydet);
            foreach (Process p in l) p.Dispose();
            return l.Count > 0;
        }

        /// <summary>Kullanıcı arayüzünden: aynı adlı ama başka yerdeki süreçleri günlüğe de yazar.</summary>
        public bool AcikMiKaydet() { return AcikMi(true); }

        /// <summary>Süreç yönetici yetkisiyle mi çalışıyor (UAC ile yükseltilmiş). Kuru kipte --sahte yonetici=… taklit eder.</summary>
        public bool Yonetici()
        {
            if (s.Kuru) return s.SahteYonetici != null;
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
            catch { return false; }
        }

        /// <summary>
        /// Masaüstü kabuğu (explorer) başka bir hesapla mı çalışıyor: yönetici olarak başka hesapla açılmış kurulum. Yalnız yükseltilmiş
        /// (yönetici) kurulumda çağrılır. B1 (G17): yükseltilmişken kabuğun sürecine/jetonuna erişilemiyorsa (OpenProcess /
        /// OpenProcessToken hatası) başka hesap SAYILIR — kendi hesabındaki explorer'a yönetici erişimi normalde vardır; erişilemiyorsa
        /// kabuk büyük olasılıkla başka bir kullanıcınındır ve kurulum yanlış profile gitmemeli.
        /// </summary>
        static bool BaskaHesapMi()
        {
            try
            {
                IntPtr w = GetShellWindow();
                if (w == IntPtr.Zero) return false;
                uint pid;
                GetWindowThreadProcessId(w, out pid);
                IntPtr p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (p == IntPtr.Zero) return true;
                try
                {
                    IntPtr t;
                    if (!OpenProcessToken(p, TOKEN_QUERY, out t)) return true;
                    try
                    {
                        using (var kabuk = new WindowsIdentity(t))
                        using (var ben = WindowsIdentity.GetCurrent())
                            return kabuk.User != null && ben.User != null && kabuk.User != ben.User;
                    }
                    finally { CloseHandle(t); }
                }
                finally { CloseHandle(p); }
            }
            catch { return false; }
        }

        /// <summary>Eski, tüm kullanıcılara (HKLM) kurulmuş Fuber AI'ın yeri; yoksa null. 64 ve 32 bit kayıt görünümlerine bakar.</summary>
        string MakineKurulumu()
        {
            if (string.IsNullOrEmpty(b.Guid)) return null;
            foreach (RegistryView g in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, g))
                    {
                        using (RegistryKey k = hklm.OpenSubKey("Software\\" + b.Guid))
                        {
                            string yer = k == null ? null : k.GetValue("InstallLocation") as string;
                            if (!string.IsNullOrEmpty(yer)) return yer;
                        }
                        using (RegistryKey k = hklm.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + b.Guid))
                            if (k != null) return (k.GetValue("DisplayName") as string) ?? b.Urun;
                    }
                }
                catch { }
            }
            return null;
        }

        /// <summary>%TEMP%\FuberAIKurulum-* altında bir günden eski (yarıda kalmış kurulumdan) klasörleri siler. En iyi çaba.</summary>
        public void EskiGecicileriTemizle()
        {
            try
            {
                DateTime sinir = DateTime.UtcNow.AddDays(-1);
                int n = 0;
                foreach (string d in Directory.GetDirectories(Path.GetTempPath(), "FuberAIKurulum-*"))
                {
                    if (gecici != null && string.Equals(d.TrimEnd('\\'), gecici.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) continue;
                    try
                    {
                        if (Directory.GetLastWriteTimeUtc(d) < sinir) { Directory.Delete(d, true); n++; }
                    }
                    catch { }
                }
                if (n > 0) Gunluk.Yaz("bir günden eski geçici kurulum klasörü silindi: " + n);
            }
            catch { }
        }

        /// <summary>"--cikis" isteğinden sonra uygulamanın kendiliğinden çıkması için beklenen süre (ms).</summary>
        const int CIKIS_BEKLE_MS = 5000;

        /// <summary>
        /// A10 (son düzeltme, Ruling E): exe "--cikis" ikinci örnek işaretini tanıyor mu — 0.8.0 ve sonrası (dosya sürümünden). Eski
        /// sürüm (0.6/0.7) işareti bilmez: ikinci örnek onun ana penceresini öne getirirdi; ona hiç gönderilmez.
        /// </summary>
        static bool CikisTanirMi(string exe)
        {
            try
            {
                FileVersionInfo v = FileVersionInfo.GetVersionInfo(exe);
                int[] p = SurumParcala(v.FileVersion) ?? SurumParcala(v.ProductVersion);
                return p != null && (p[0] > 0 || p[1] >= 8);
            }
            catch { return false; }
        }

        /// <summary>
        /// Açık uygulamayı kapatır. A10: önce (0.8.0+ ise) "--cikis" ile uygulamanın kendisinden nazikçe çıkması istenir — bekleyen
        /// silmeler uygulanır, normal çıkış akışı (before-quit) çalışır — ve birkaç saniye beklenir. Olmazsa eski yol: süreçlerin görünür
        /// pencerelerine WM_CLOSE; çıkmazlarsa süreç sonlandırılır. Yalnız SurecAdi adlı, bu oturumdaki süreçler.
        /// Dönüş: "yok" | "cikis" | "nazik" | "zorla" | null (kapatılamadı).
        /// </summary>
        public string UygulamayiKapat()
        {
            List<Process> l = AcikSurecler(true);
            if (l.Count == 0) return "yok";
            var kimlikler = new HashSet<uint>();
            string exe = null;
            foreach (Process p in l) { kimlikler.Add((uint)p.Id); if (exe == null) exe = SurecYolu(p.Id); p.Dispose(); }
            if (exe != null && CikisTanirMi(exe))
            {
                try
                {
                    using (Process.Start(new ProcessStartInfo(exe, "--cikis") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(exe) })) { }
                    Gunluk.Yaz("--cikis istendi: " + exe);
                    if (Bekle(CIKIS_BEKLE_MS)) { Gunluk.Yaz(SurecAdi + " --cikis ile kendiliğinden çıktı"); return "cikis"; }
                    Gunluk.Yaz("--cikis ile " + CIKIS_BEKLE_MS + " ms içinde çıkmadı; kapat isteğine geçiliyor");
                }
                catch (Exception e) { Gunluk.Yaz("--cikis başlatılamadı: " + e.Message); }
            }
            int gonderilen = 0;
            EnumWindows(delegate(IntPtr h, IntPtr _)
            {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (kimlikler.Contains(pid) && IsWindowVisible(h)) { PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); gonderilen++; }
                return true;
            }, IntPtr.Zero);
            Gunluk.Yaz(SurecAdi + " açık (" + kimlikler.Count + " süreç); " + gonderilen + " pencereye kapat isteği gönderildi");
            // Tepsideki uygulamanın görünür penceresi yoksa nazik yol yoktur: kısa bekleyip sonlandır. (Fuber AI 0.6/0.7 kapat isteğinde
            // pencereyi gizler, çıkmaz; bu yüzden bekleme uzun tutulmaz.)
            if (Bekle(gonderilen > 0 ? 2500 : 300)) return "nazik";
            foreach (Process p in AcikSurecler(false))
            {
                try { p.Kill(); Gunluk.Yaz("süreç sonlandırıldı: " + p.Id); }
                catch (Exception e) { Gunluk.Yaz("süreç sonlandırılamadı: " + p.Id + " " + e.Message); }
                finally { p.Dispose(); }
            }
            if (Bekle(5000)) return "zorla";
            Gunluk.Yaz(SurecAdi + " kapatılamadı");
            return null;
        }

        bool Bekle(int ms)
        {
            var saat = Stopwatch.StartNew();
            while (true)
            {
                if (!AcikMi()) return true;
                if (saat.ElapsedMilliseconds >= ms) return false;
                Thread.Sleep(150);
            }
        }

        Stream PaketAkisi()
        {
            if (s.Kuru) return new FileStream(s.SahtePaket, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16);
            return Kaynak.Ac("paket.exe");
        }

        /// <summary>
        /// Paketi geçici klasöre akışla çıkarır ve sessiz kurar. Arka iş parçacığında çalışır; ilerlemeyi bildirir.
        /// Dönüş: NSIS çıkış kodu. Paket çıkarılamazsa KurulumIstisnasi.
        /// </summary>
        public int Kur(Bildirici bildir)
        {
            Temizle();
            gecici = Path.Combine(Path.GetTempPath(), "FuberAIKurulum-" + System.Guid.NewGuid().ToString("N").Substring(0, 10));
            string paket = Path.Combine(gecici, s.Kuru ? Path.GetFileName(s.SahtePaket) : "Fuber AI Paket.exe");
            Gunluk.Yaz("— kurulum " + b.Surum + " başlıyor; hedef: " + Hedef + (s.Kuru ? " (KURU)" : ""));
            try
            {
                Directory.CreateDirectory(gecici);
                using (Stream kaynak = PaketAkisi())
                {
                    if (kaynak == null) throw new KurulumIstisnasi(HataBilgisi.PaketYok());
                    long toplam = kaynak.Length, yazilan = 0, son = 0;
                    using (var hedef = new FileStream(paket, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                    {
                        var tampon = new byte[1 << 20];
                        int n;
                        while ((n = kaynak.Read(tampon, 0, tampon.Length)) > 0)
                        {
                            hedef.Write(tampon, 0, n);
                            yazilan += n;
                            if (yazilan - son >= (4L << 20)) { son = yazilan; bildir("cikar", toplam > 0 ? (double)yazilan / toplam : 1, -1); }
                        }
                    }
                    if (toplam > 0 && yazilan != toplam) throw new IOException("paket eksik çıkarıldı (" + yazilan + "/" + toplam + " bayt)");
                    Gunluk.Yaz("paket çıkarıldı: " + paket + " (" + yazilan + " bayt)");
                }
            }
            catch (KurulumIstisnasi) { throw; }
            catch (Exception e)
            {
                Gunluk.Yaz("paket çıkarılamadı: " + e);
                Temizle();
                throw new KurulumIstisnasi(HataBilgisi.Paket(e.Message, Gunluk.KisaYol));
            }
            bildir("cikar", 1, -1);

            long ilk = KlasorBoyutu(Hedef);
            bildir("kur", 0, ilk);
            // /D= en sonda ve tırnaksız olmalı (NSIS kuralı; electron-builder GetDParameter boşluklu yolu destekler).
            string arg = "/S /D=" + Hedef;
            Gunluk.Yaz("NSIS başlıyor: \"" + paket + "\" " + arg + " (hedefte " + ilk + " bayt)");
            var saat = Stopwatch.StartNew();
            // Geçiciye yazılamama (yukarıda, HataBilgisi.Paket) ile çalıştırılamama (virüs koruması siler/engeller) ayrı mesajdır.
            if (!File.Exists(paket)) throw BaslatmaHatasi("paket çıkarıldıktan sonra kayboldu (virüs koruması silmiş olabilir)");
            Process p;
            try
            {
                p = Process.Start(new ProcessStartInfo(paket, arg) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = gecici });
            }
            catch (Win32Exception e)
            {
                if (e.NativeErrorCode != 740) throw BaslatmaHatasi(e.Message + " (" + e.NativeErrorCode + ")");
                // Yükseltme isterse (beklenmez: kurulum kullanıcıya özel) kabuk üzerinden.
                try { p = Process.Start(new ProcessStartInfo(paket, arg) { UseShellExecute = true, WorkingDirectory = gecici }); }
                catch (Exception e2) { throw BaslatmaHatasi(e2.Message); }
            }
            catch (Exception e) { throw BaslatmaHatasi(e.Message); }
            if (p == null) throw BaslatmaHatasi("kurulum süreci başlatılamadı");
            try
            {
                while (!p.WaitForExit(200)) bildir("kur", 0, KlasorBoyutu(Hedef));
                p.WaitForExit();
                int kod = p.ExitCode;
                long son = KlasorBoyutu(Hedef);
                bildir("kur", 0, son);
                Gunluk.Yaz("NSIS bitti: çıkış kodu " + kod + ", " + saat.Elapsed.TotalSeconds.ToString("0.0", CultureInfo.InvariantCulture)
                    + " sn, hedefte " + son + " bayt");
                if (kod != 0) Gunluk.Yaz(NsisAyrinti(kod));
                return kod;
            }
            finally
            {
                p.Dispose();
                Temizle();
            }
        }

        KurulumIstisnasi BaslatmaHatasi(string neden)
        {
            Gunluk.Yaz("paket başlatılamadı: " + neden);
            Temizle();
            return new KurulumIstisnasi(HataBilgisi.Baslatilamadi(neden, Gunluk.KisaYol));
        }

        string NsisAyrinti(int kod)
        {
            int ana, derleme;
            string w = WindowsSurumu(out ana, out derleme);
            string anlam = kod == 1 ? "kurulum iptal edildi" : kod == 2 ? "kurulum betiği durdu (uygulama kapatılamadı, dosya kullanımda ya da yazma izni yok)" : "bilinmeyen kod";
            string bos = "?";
            try { bos = new DriveInfo(Path.GetPathRoot(Hedef)).AvailableFreeSpace.ToString(CultureInfo.InvariantCulture); } catch { }
            return "NSIS ayrıntı: " + anlam + "; Windows " + w + "; hedef " + Hedef + "; boş alan " + bos + " bayt; açık mı: " + AcikMi();
        }

        /// <summary>
        /// Kurulumdan sonra açılacak exe: NSIS'in yazdığı kurulum yeri (yoksa hedef) + exe adı. Var mı ve sürümü gömülü sürümle
        /// aynı mı (NSIS 0 dönüp eski dosyaları yerinde bırakmış olabilir). Sorun yoksa null.
        /// </summary>
        public HataBilgisi UygulamayiDogrula()
        {
            // B1 (G17): beklenmeyen bir hata (kayıt defteri, dosya sürümü okunamadı…) pencereyi "Kuruluyor"da ve kapanma engeliyle
            // bırakmasın — UI iş parçacığında çağrılır: hata ekranına dönülür.
            try { return UygulamayiDogrulaIc(); }
            catch (Exception e)
            {
                Gunluk.Yaz("doğrulama beklenmeyen hata: " + e);
                return HataBilgisi.Beklenmeyen(e.Message, Gunluk.KisaYol);
            }
        }

        HataBilgisi UygulamayiDogrulaIc()
        {
            if (s.Kuru) UygulamaYolu = s.SahteUygulama;
            else
            {
                string konum = KayitliKonum();
                UygulamaYolu = Path.Combine(string.IsNullOrEmpty(konum) ? Hedef : konum, b.Exe);
            }
            if (!File.Exists(UygulamaYolu))
            {
                Gunluk.Yaz("uygulama YOK: " + UygulamaYolu);
                return HataBilgisi.ExeYok(UygulamaYolu);
            }
            int[] beklenen = SurumParcala(b.Surum);
            if (beklenen == null)
            {
                Gunluk.Yaz("uygulama bulundu (sürüm denetimi yok: " + b.Surum + "): " + UygulamaYolu);
                return null;
            }
            FileVersionInfo v = FileVersionInfo.GetVersionInfo(UygulamaYolu);
            // Electron: FileVersion "0.8.0", ProductVersion "0.8.0.0" → sayısal karşılaştırma, YALNIZ ana.ara.yama (B1: 4. parça derleme
            // numarası taşıyabilir — BUILD_NUMBER — ve aynı sürümü "uyuşmuyor" saydırmamalı).
            if (SurumEsit(SurumParcala(v.FileVersion), beklenen) || SurumEsit(SurumParcala(v.ProductVersion), beklenen))
            {
                Gunluk.Yaz("uygulama doğrulandı: " + UygulamaYolu + " (" + v.FileVersion + ")");
                return null;
            }
            string kurulu = !string.IsNullOrEmpty(v.FileVersion) ? v.FileVersion : (v.ProductVersion ?? "?");
            Gunluk.Yaz("SÜRÜM UYUŞMUYOR: " + UygulamaYolu + " dosya " + v.FileVersion + " / ürün " + v.ProductVersion + ", beklenen " + b.Surum);
            return HataBilgisi.SurumUyusmuyor(kurulu, b.Surum, Gunluk.KisaYol);
        }

        static int[] SurumParcala(string s0)
        {
            if (string.IsNullOrEmpty(s0)) return null;
            int i = 0;
            while (i < s0.Length && (char.IsDigit(s0[i]) || s0[i] == '.')) i++;
            string[] p = s0.Substring(0, i).Split(new[] { '.' }, StringSplitOptions.RemoveEmptyEntries);
            if (p.Length == 0) return null;
            var r = new int[4];
            for (int k = 0; k < 4 && k < p.Length; k++) if (!int.TryParse(p[k], out r[k])) return null;
            return r;
        }

        /// <summary>Ana.ara.yama eşit mi (4. parça — derleme numarası — sayılmaz; B1).</summary>
        static bool SurumEsit(int[] a, int[] b0)
        {
            if (a == null || b0 == null) return false;
            for (int k = 0; k < 3; k++) if (a[k] != b0[k]) return false;
            return true;
        }

        /// <summary>
        /// Uygulamayı açar. Kurulum yönetici olarak açıldıysa uygulama yönetici OLMASIN: masaüstü kabuğu (explorer) üzerinden,
        /// kullanıcının normal yetkisiyle başlatılır. Dönüş: "kabuk" | "explorer".
        /// </summary>
        public string UygulamayiAc()
        {
            if (Yonetici())
            {
                string explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
                using (Process.Start(new ProcessStartInfo(explorer, "\"" + UygulamaYolu + "\"") { UseShellExecute = false })) { }
                Gunluk.Yaz("uygulama yönetici yetkisi olmadan (explorer üzerinden) açıldı: " + UygulamaYolu);
                return "explorer";
            }
            using (Process.Start(new ProcessStartInfo(UygulamaYolu) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(UygulamaYolu) })) { }
            Gunluk.Yaz("uygulama açıldı: " + UygulamaYolu);
            return "kabuk";
        }

        /// <summary>
        /// Görev 22 (K13): kurulum bitince Windows'un ikon önbelleği tazelenir — exe'nin ikonu değişti ama yolu aynı; kabuk eski resmi
        /// (ör. eski sürümün bayat ikonu) önbellekten göstermesin. Masaüstü, Başlat menüsü ve görev çubuğuna
        /// sabitlenmiş kısayollardan HEDEFİ kurulu exe olanların ikonu exe'nin kendi ikonuna (dizin 0) çevrilir (başka yere bakıyorsa),
        /// her biri ve exe için SHCNE_UPDATEITEM, en sonda SHCNE_ASSOCCHANGED (kabuk ikonları yeniden yükler). Kuru kipte YALNIZ hedefin
        /// yanındaki "kisayollar" test klasörüne bakılır ve kabuğun genel tazelemesi atlanır (kullanıcının masaüstüne dokunulmaz).
        /// Kurulumu asla düşürmez: her adım kendi hatasını günlüğe yazar. Dönüş: rapor için kısa özet.
        /// </summary>
        public string KabukIkonlariniTazele()
        {
            if (string.IsNullOrEmpty(UygulamaYolu)) return "uygulama yok";
            string exe;
            try { exe = Path.GetFullPath(UygulamaYolu); } catch { exe = UygulamaYolu; }
            var klasorler = new List<string>();
            if (s.Kuru) klasorler.Add(Path.Combine(Path.GetDirectoryName(Hedef.TrimEnd('\\')) ?? Hedef, "kisayollar"));
            else
            {
                string appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                klasorler.Add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
                klasorler.Add(Environment.GetFolderPath(Environment.SpecialFolder.Programs));
                klasorler.Add(Path.Combine(appdata, "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"));
            }
            int bulunan = 0, duzeltilen = 0;
            foreach (string k in klasorler)
            {
                if (string.IsNullOrEmpty(k) || !Directory.Exists(k)) continue;
                string[] dosyalar;
                try { dosyalar = Directory.GetFiles(k, "*.lnk"); } catch { continue; }
                foreach (string lnk in dosyalar)
                {
                    try
                    {
                        string sonuc = KabukIkonlari.KisayoluDenetle(lnk, exe);
                        if (sonuc == null) continue;
                        bulunan++;
                        if (sonuc == "duzeltildi") { duzeltilen++; Gunluk.Yaz("kısayol ikonu düzeltildi (exe'nin ikonuna): " + lnk); }
                        KabukIkonlari.OgeyiTazele(lnk);
                    }
                    catch (Exception e) { Gunluk.Yaz("kısayol denetlenemedi: " + lnk + " — " + e.Message); }
                }
            }
            try { KabukIkonlari.OgeyiTazele(exe); } catch (Exception e) { Gunluk.Yaz("exe ikonu tazelenemedi: " + e.Message); }
            string kabuk;
            if (s.Kuru) kabuk = "kuru kipte atlandı";
            else
            {
                try { KabukIkonlari.IlisikleriTazele(); kabuk = "tazelendi"; }
                catch (Exception e) { kabuk = "tazelenemedi: " + e.Message; }
            }
            string ozet = "kısayol " + bulunan + ", düzeltilen " + duzeltilen + ", kabuk ikon önbelleği " + kabuk;
            Gunluk.Yaz("kabuk ikonları: " + ozet);
            return ozet;
        }

        public bool Temizle()
        {
            if (gecici == null || !Directory.Exists(gecici)) return true;
            for (int deneme = 0; deneme < 5; deneme++)
            {
                try { Directory.Delete(gecici, true); return true; }
                catch { Thread.Sleep(200); }
            }
            Gunluk.Yaz("geçici klasör silinemedi: " + gecici);
            return false;
        }

        /// <summary>Klasör ağacının toplam boyutu; dosyalar yazılırken okunur, erişilemeyen girdiler atlanır.</summary>
        public static long KlasorBoyutu(string yol)
        {
            long t = 0;
            try
            {
                if (!Directory.Exists(yol)) return 0;
                var yigin = new Stack<DirectoryInfo>();
                yigin.Push(new DirectoryInfo(yol));
                while (yigin.Count > 0)
                {
                    DirectoryInfo d = yigin.Pop();
                    try
                    {
                        foreach (FileInfo f in d.GetFiles()) { try { t += f.Length; } catch { } }
                        foreach (DirectoryInfo a in d.GetDirectories()) yigin.Push(a);
                    }
                    catch { }
                }
            }
            catch { }
            return t;
        }
    }

    /// <summary>
    /// Görev 22 (K13): kısayolun hedefi ve ikonu (IShellLinkW + IPersistFile; Windows'un kendi kısayol arabirimi) ve kabuk bildirimi
    /// (SHChangeNotify). Kurucu.KabukIkonlariniTazele kullanır.
    /// </summary>
    internal static class KabukIkonlari
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern void SHChangeNotify(int olay, uint bayrak, string oge1, IntPtr oge2);
        [DllImport("shell32.dll")] static extern void SHChangeNotify(int olay, uint bayrak, IntPtr oge1, IntPtr oge2);
        const int SHCNE_UPDATEITEM = 0x00002000, SHCNE_ASSOCCHANGED = 0x08000000;
        const uint SHCNF_IDLIST = 0x0000, SHCNF_PATHW = 0x0005, SHCNF_FLUSHNOWAIT = 0x3000;

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class KabukBaglantisi { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dosya, int boy, IntPtr bul, uint bayrak);
            void GetIDList(out IntPtr pidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder ad, int boy);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string ad);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder klasor, int boy);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string klasor);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arg, int boy);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arg);
            void GetHotkey(out short tus);
            void SetHotkey(short tus);
            void GetShowCmd(out int komut);
            void SetShowCmd(int komut);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder yol, int boy, out int dizin);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string yol, int dizin);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string goreli, uint ayrilmis);
            void Resolve(IntPtr pencere, uint bayrak);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string dosya);
        }

        static string Tam(string yol)
        {
            if (string.IsNullOrEmpty(yol)) return "";
            try { return Path.GetFullPath(Environment.ExpandEnvironmentVariables(yol.Trim().Trim('"'))).TrimEnd('\\'); }
            catch { return yol; }
        }

        /// <summary>
        /// Kısayolun hedefi `exe` değilse null (dokunulmaz). Hedefi exe ise: ikonu başka bir dosyaya ya da exe'nin başka bir dizinine
        /// bakıyorsa exe'nin kendi ikonuna (dizin 0) çevrilip kaydedilir → "duzeltildi"; zaten exe'nin ikonuysa (ya da boşsa: hedefin
        /// ikonu kullanılır) → "dogru".
        /// </summary>
        public static string KisayoluDenetle(string lnk, string exe)
        {
            var bag = (IShellLinkW)new KabukBaglantisi();
            try
            {
                var dosya = (IPersistFile)bag;
                dosya.Load(lnk, 0);
                var hedef = new StringBuilder(1024);
                bag.GetPath(hedef, hedef.Capacity, IntPtr.Zero, 0);
                if (!string.Equals(Tam(hedef.ToString()), Tam(exe), StringComparison.OrdinalIgnoreCase)) return null;
                var ikon = new StringBuilder(1024);
                int dizin;
                bag.GetIconLocation(ikon, ikon.Capacity, out dizin);
                string ikonYolu = Tam(ikon.ToString());
                if (ikonYolu.Length == 0 || (string.Equals(ikonYolu, Tam(exe), StringComparison.OrdinalIgnoreCase) && dizin == 0)) return "dogru";
                bag.SetIconLocation(exe, 0);
                dosya.Save(lnk, true);
                return "duzeltildi";
            }
            finally { Marshal.FinalReleaseComObject(bag); }
        }

        /// <summary>Kabuğa "bu öğe değişti" der: gösterdiği yerde ikonunu yeniden okur (bekletmez).</summary>
        public static void OgeyiTazele(string yol) { SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, yol, IntPtr.Zero); }

        /// <summary>Kabuğun bütün ikonları yeniden yüklemesi (dosya ilişkileri değişti bildirimi; kurulumların bilinen yolu).</summary>
        public static void IlisikleriTazele() { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST | SHCNF_FLUSHNOWAIT, IntPtr.Zero, IntPtr.Zero); }
    }
}
