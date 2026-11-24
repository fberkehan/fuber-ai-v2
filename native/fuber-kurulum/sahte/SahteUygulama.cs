// Kurulum başlatıcısı testi için SAHTE uygulama (scripts/dev/kurulum-ekrani-onizle.mjs derler; adı "fuber-sahte-uygulama" —
// başlatıcı kuru kipte yalnız bu adla çalışan süreçlere bakar, gerçek "Fuber AI"ye dokunmaz).
//  (bağımsız değişkensiz)  kurulumdan sonra açılan uygulama: işaret dosyası yazar, çıkar.
//  --bekle-nazik           "açık uygulama": ekran dışında görünür pencere; kapat isteğinde (WM_CLOSE) kapanır; --cikis'i duymaz.
//  --bekle-inatci          "tepsideki uygulama": kapat isteğini yok sayar (Electron'un pencereyi gizlemesi gibi) → sonlandırılmalı.
//  --bekle-cikis           0.8.0+ uygulama (A10): ikinci örneğin "--cikis" isteğinde kendiliğinden, nazikçe çıkar (WM_CLOSE'u yok sayar).
//  --cikis                 ikinci örnek (başlatıcı yükseltmede çalıştırır): çalışan örneğe çıkış isteği bırakır, hemen çıkar.
// Bekleyen kipler en geç 60 sn sonra kendiliğinden çıkar (test yarıda kalırsa ortada süreç kalmasın).
// Ortam: FUBER_SAHTE_ISARET = işaret klasörü (yoksa %TEMP%\fuber-sahte-isaret).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace FuberSahte
{
    internal sealed class BekleyenPencere : Form
    {
        readonly bool inatci;
        readonly string isaret;

        public BekleyenPencere(bool inatci, string isaret, bool cikisDuyar)
        {
            this.inatci = inatci;
            this.isaret = isaret;
            Text = "fuber-sahte-uygulama";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            Size = new Size(120, 80);
            var t = new Timer { Interval = 60000 };
            t.Tick += delegate { Environment.Exit(9); };
            t.Start();
            if (cikisDuyar)
            {
                // Electron'un second-instance olayı gibi: ikinci örneğin bıraktığı istek görülünce nazik çıkış (bekleyen işler biter).
                string istek = Path.Combine(isaret, "cikis-istendi.txt");
                var c = new Timer { Interval = 100 };
                c.Tick += delegate
                {
                    if (!File.Exists(istek)) return;
                    File.WriteAllText(Path.Combine(isaret, "uygulama-cikis-ile-kapandi.txt"), DateTime.Now.ToString("o"));
                    Environment.Exit(0);
                };
                c.Start();
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00000080 | 0x08000000; // WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
                return cp;
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            File.WriteAllText(Path.Combine(isaret, "uygulama-calisiyor.txt"), Process.GetCurrentProcess().Id.ToString());
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Başka süreçten gelen WM_CLOSE WinForms'ta CloseReason.None olur; inatçı kip her kapat isteğini yok sayar.
            if (inatci && e.CloseReason != CloseReason.WindowsShutDown) { e.Cancel = true; return; }
            File.WriteAllText(Path.Combine(isaret, "uygulama-nazik-kapandi.txt"), DateTime.Now.ToString("o"));
            base.OnFormClosing(e);
        }
    }

    internal static class Uygulama
    {
        [STAThread]
        static int Main(string[] args)
        {
            string isaret = Environment.GetEnvironmentVariable("FUBER_SAHTE_ISARET");
            if (string.IsNullOrEmpty(isaret)) isaret = Path.Combine(Path.GetTempPath(), "fuber-sahte-isaret");
            Directory.CreateDirectory(isaret);
            if (args.Length > 0 && (args[0] == "--bekle-nazik" || args[0] == "--bekle-inatci" || args[0] == "--bekle-cikis"))
            {
                // --bekle-cikis kapat isteğini (WM_CLOSE) de yok sayar: kapanışı yalnız --cikis yoluyla olduğu ölçülsün.
                Application.Run(new BekleyenPencere(args[0] != "--bekle-nazik", isaret, args[0] == "--bekle-cikis"));
                return 0;
            }
            if (args.Length > 0 && args[0] == "--cikis")
            {
                File.WriteAllText(Path.Combine(isaret, "cikis-istendi.txt"), Process.GetCurrentProcess().Id + " " + DateTime.Now.ToString("o"));
                return 0;
            }
            File.AppendAllText(Path.Combine(isaret, "uygulama-acildi.txt"),
                Process.GetCurrentProcess().Id + " " + Environment.CommandLine + " | " + Environment.CurrentDirectory + Environment.NewLine);
            return 0;
        }
    }
}
