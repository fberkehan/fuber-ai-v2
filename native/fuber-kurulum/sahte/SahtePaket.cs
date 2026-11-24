// Kurulum başlatıcısı testi için SAHTE NSIS paketi (scripts/dev/kurulum-ekrani-onizle.mjs derler; dağıtıma girmez).
// Gerçek hiçbir şey kurmaz: NSIS gibi "/S /D=<hedef>" alır, hedefe yavaşça küçük dosyalar yazar (başlatıcının ilerlemesi klasör
// boyutundan beslenir) ve işaret klasörüne komut satırını bırakır.
// Ortam: FUBER_SAHTE_ISARET = işaret klasörü (yoksa %TEMP%\fuber-sahte-isaret); FUBER_SAHTE_KIP = basarili | hata | bir-kez-hata | yukseltme.
// Çıkış: 0 başarı, 2 NSIS'in "betik durdu" kodu, 5 hatalı çağrı (sessiz değil / hedef yok).
using System;
using System.IO;
using System.Threading;

namespace FuberSahte
{
    internal static class Paket
    {
        static int Main(string[] args)
        {
            string isaret = Environment.GetEnvironmentVariable("FUBER_SAHTE_ISARET");
            if (string.IsNullOrEmpty(isaret)) isaret = Path.Combine(Path.GetTempPath(), "fuber-sahte-isaret");
            string kip = Environment.GetEnvironmentVariable("FUBER_SAHTE_KIP") ?? "basarili";
            Directory.CreateDirectory(isaret);
            string satir = Environment.CommandLine;
            File.AppendAllText(Path.Combine(isaret, "paket-calisti.txt"), satir + Environment.NewLine);
            int d = satir.IndexOf("/D=", StringComparison.Ordinal);
            string hedef = d >= 0 ? satir.Substring(d + 3).Trim() : null;
            if (Array.IndexOf(args, "/S") < 0 || string.IsNullOrEmpty(hedef)) return 5;

            if (kip == "hata") { Thread.Sleep(600); return 2; }
            if (kip == "bir-kez-hata")
            {
                string sayac = Path.Combine(isaret, "bir-kez-hata.sayac");
                if (!File.Exists(sayac)) { File.WriteAllText(sayac, "1"); Thread.Sleep(600); return 2; }
            }
            Directory.CreateDirectory(hedef);
            if (kip == "yukseltme")
            {
                // Eski sürümün kaldırıcısı gibi: önce klasör boşalır.
                foreach (string f in Directory.GetFiles(hedef)) { File.Delete(f); Thread.Sleep(40); }
            }
            var mb = new byte[1 << 20];
            for (int i = 0; i < 30; i++)
            {
                File.WriteAllBytes(Path.Combine(hedef, "parca-" + i.ToString("00") + ".bin"), mb);
                Thread.Sleep(80);
            }
            return 0;
        }
    }
}
