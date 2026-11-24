# ── İkon denetimi (0.10 E1, K7): Windows'un GERÇEKTEN gösterdiği ikon Fuber'in mi? ────────────────────────────────────────────
# YALNIZ OKUR: dosyaya, kısayola, kayıt defterine yazmaz; ekran yakalamaz. Çıktı tek satır JSON (stdout, UTF-8).
# Karşılaştırma piksel piksel: her ikon Windows'un kendi yükleyicisiyle (LoadImage / PrivateExtractIcons) aynı boyda 32 bit BGRA'ya
# açılır; iki saydam piksel eşit sayılır, öteki piksellerde bir kanal 16'dan fazla farklıysa piksel "farklı"dır. `fark` = farklı
# piksellerin oranı (0 = birebir). `-Karsi` (Electron'un kendi exe'si) karşı örnektir: ölçümün Fuber'i Electron'dan ayırdığını gösterir.
#
#  -Kip exe     -Exe <exe> -Ico <build/icon.ico> [-Karsi <electron.exe>]
#      exe'nin kaynak ikonu: kabuğun gösterdiği ilişkili ikon (System.Drawing.Icon.ExtractAssociatedIcon, 32 px) ve kaynaktan
#      256 px (PrivateExtractIcons) — .ico'nun aynı boy katmanıyla.
#  -Kip pencere -Hwnd <ondalık tutamaç,…> -Ico <resources/ikon/fuber.ico> [-Karsi <electron.exe>]
#      her pencerenin görev çubuğu / Alt+Tab ikonu (WM_GETICON büyük ve küçük; verilmemişse pencere sınıfının ikonu = exe'ninki)
#      ve pencereye yazılmış AppUserModelID (SHGetPropertyStoreForWindow; yazılmamışsa boş — süreç kimliği geçerlidir).
# Çağıran: scripts/dev/ikon-denetimi.mjs (kurulu-duman.mjs, ikon-onizle.mjs) — UTF-8 BOM'lu geçici kopyasını çalıştırır (depoda BOM
# yasak: tests/kaynak-gorunmez.test.ts; Windows PowerShell 5.1 BOM'suz dosyayı ANSI okur).
param(
  [Parameter(Mandatory = $true)][ValidateSet('exe', 'pencere')][string]$Kip,
  [string]$Exe,
  [Parameter(Mandatory = $true)][string]$Ico,
  [string]$Karsi,
  [string]$Hwnd
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class FuberIkonOlcum
{
    public string Ad { get; set; }
    public int Boy { get; set; }
    public double Fark { get; set; }
    public double KarsiFark { get; set; }
    public string Hata { get; set; }
}

public class FuberPencereOlcum
{
    public string Hwnd { get; set; }
    public bool Var { get; set; }
    public bool Gorunur { get; set; }
    public bool AracPenceresi { get; set; }
    public string Baslik { get; set; }
    public string Kimlik { get; set; }
    public bool BuyukVerilmis { get; set; }
    public bool KucukVerilmis { get; set; }
    public FuberIkonOlcum Buyuk { get; set; }
    public FuberIkonOlcum Kucuk { get; set; }
}

public static class FuberIkonDenetimi
{
    const uint IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10, WM_GETICON = 0x7F, SMTO_ABORTIFHUNG = 0x2;
    const int GCLP_HICON = -14, GCLP_HICONSM = -34, GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr hinst, string ad, uint tur, int cx, int cy, uint bayrak);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint PrivateExtractIcons(string dosya, int dizin, int cx, int cy, IntPtr[] ikonlar, uint[] kimlikler, uint adet, uint bayrak);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint mesaj, IntPtr w, IntPtr l, uint bayrak, uint sure, out IntPtr sonuc);
    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] static extern IntPtr GetClassLongPtr(IntPtr hwnd, int dizin);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int dizin);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int n, out BITMAP bm);
    [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc, IntPtr hbm, uint ilk, uint satir, byte[] bitler, ref BITMAPINFOHEADER bi, uint kullanim);
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

    [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
    [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }
    [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount; public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter; public uint biClrUsed; public uint biClrImportant; }
    [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Sequential)] struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint n);
        [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
        [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
        [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
        [PreserveSig] int Commit();
    }

    /// <summary>İkonun renk bitlemi: 32 bit BGRA, yukarıdan aşağı. Boy çıktıda.</summary>
    static byte[] Pikseller(IntPtr ikon, out int boy)
    {
        boy = 0;
        ICONINFO ii;
        if (ikon == IntPtr.Zero || !GetIconInfo(ikon, out ii)) return null;
        try
        {
            if (ii.hbmColor == IntPtr.Zero) return null; // tek renkli (maske) ikon: Fuber'in değil
            BITMAP bm;
            GetObject(ii.hbmColor, Marshal.SizeOf(typeof(BITMAP)), out bm);
            int w = bm.bmWidth, h = bm.bmHeight;
            var bi = new BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
            var bitler = new byte[w * h * 4];
            IntPtr dc = GetDC(IntPtr.Zero);
            try { if (GetDIBits(dc, ii.hbmColor, 0, (uint)h, bitler, ref bi, 0) == 0) return null; }
            finally { ReleaseDC(IntPtr.Zero, dc); }
            boy = w;
            return bitler;
        }
        finally
        {
            if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
            if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
        }
    }

    static double Fark(byte[] a, byte[] b)
    {
        if (a == null || b == null || a.Length != b.Length || a.Length == 0) return 1.0;
        int n = a.Length / 4, farkli = 0;
        for (int i = 0; i < n; i++)
        {
            int o = i * 4;
            if (a[o + 3] == 0 && b[o + 3] == 0) continue;
            for (int c = 0; c < 4; c++) if (Math.Abs(a[o + c] - b[o + c]) > 16) { farkli++; break; }
        }
        return Math.Round((double)farkli / n, 4);
    }

    static byte[] IcodanPikseller(string ico, int boy)
    {
        IntPtr h = LoadImage(IntPtr.Zero, ico, IMAGE_ICON, boy, boy, LR_LOADFROMFILE);
        if (h == IntPtr.Zero) return null;
        try { int b; return Pikseller(h, out b); } finally { DestroyIcon(h); }
    }

    static byte[] ExedenPikseller(string exe, int boy)
    {
        if (string.IsNullOrEmpty(exe)) return null;
        var ikonlar = new IntPtr[1];
        var kimlikler = new uint[1];
        uint n = PrivateExtractIcons(exe, 0, boy, boy, ikonlar, kimlikler, 1, 0);
        if (n == 0 || n == 0xFFFFFFFF || ikonlar[0] == IntPtr.Zero) return null;
        try { int b; return Pikseller(ikonlar[0], out b); } finally { DestroyIcon(ikonlar[0]); }
    }

    /// <summary>Bir ikon tutamacı: .ico'nun aynı boy katmanıyla ve karşı örnekle (exe) farkı.</summary>
    static FuberIkonOlcum Olc(string ad, IntPtr ikon, string ico, string karsi)
    {
        var o = new FuberIkonOlcum { Ad = ad, Fark = 1.0, KarsiFark = 1.0 };
        int boy;
        byte[] p = Pikseller(ikon, out boy);
        if (p == null) { o.Hata = "ikon yok ya da okunamadı"; return o; }
        o.Boy = boy;
        o.Fark = Fark(p, IcodanPikseller(ico, boy));
        if (!string.IsNullOrEmpty(karsi)) o.KarsiFark = Fark(p, ExedenPikseller(karsi, boy));
        return o;
    }

    public static FuberIkonOlcum[] ExeDenetle(string exe, string ico, string karsi)
    {
        var sonuc = new List<FuberIkonOlcum>();
        // 1) Kabuğun gösterdiği ilişkili ikon (32 px; Gezgin, kısayol, görev çubuğu).
        try
        {
            using (var ik = System.Drawing.Icon.ExtractAssociatedIcon(exe)) sonuc.Add(Olc("iliskili", ik.Handle, ico, karsi));
        }
        catch (Exception e) { sonuc.Add(new FuberIkonOlcum { Ad = "iliskili", Fark = 1.0, KarsiFark = 1.0, Hata = e.Message }); }
        // 2) exe kaynağındaki ikon grubundan doğrudan 256 px ve 32 px (rcedit'in yazdığı katmanlar).
        foreach (int boy in new[] { 256, 32 })
        {
            var ikonlar = new IntPtr[1];
            var kimlikler = new uint[1];
            uint n = PrivateExtractIcons(exe, 0, boy, boy, ikonlar, kimlikler, 1, 0);
            if (n == 0 || n == 0xFFFFFFFF || ikonlar[0] == IntPtr.Zero) { sonuc.Add(new FuberIkonOlcum { Ad = "kaynak" + boy, Boy = boy, Fark = 1.0, KarsiFark = 1.0, Hata = "exe'de ikon kaynağı yok" }); continue; }
            try { sonuc.Add(Olc("kaynak" + boy, ikonlar[0], ico, karsi)); } finally { DestroyIcon(ikonlar[0]); }
        }
        return sonuc.ToArray();
    }

    static IntPtr IkonIste(IntPtr hwnd, int tur)
    {
        IntPtr sonuc;
        if (SendMessageTimeout(hwnd, WM_GETICON, (IntPtr)tur, IntPtr.Zero, SMTO_ABORTIFHUNG, 2000, out sonuc) == IntPtr.Zero) return IntPtr.Zero;
        return sonuc;
    }

    static string PencereKimligi(IntPtr hwnd)
    {
        var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore ps;
        if (SHGetPropertyStoreForWindow(hwnd, ref iid, out ps) != 0 || ps == null) return null;
        try
        {
            var k = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
            PROPVARIANT v;
            if (ps.GetValue(ref k, out v) != 0) return null;
            try { return v.vt == 31 && v.p != IntPtr.Zero ? Marshal.PtrToStringUni(v.p) : ""; }
            finally { PropVariantClear(ref v); }
        }
        finally { Marshal.ReleaseComObject(ps); }
    }

    public static FuberPencereOlcum[] PencereDenetle(long[] tutamaclar, string ico, string karsi)
    {
        var sonuc = new List<FuberPencereOlcum>();
        foreach (long t in tutamaclar)
        {
            var h = new IntPtr(t);
            var o = new FuberPencereOlcum { Hwnd = t.ToString(), Var = IsWindow(h) };
            if (!o.Var) { sonuc.Add(o); continue; }
            o.Gorunur = IsWindowVisible(h);
            o.AracPenceresi = (GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64() & WS_EX_TOOLWINDOW) != 0;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            o.Baslik = sb.ToString();
            o.Kimlik = PencereKimligi(h);
            // Görev çubuğu ve Alt+Tab: pencerenin büyük ikonu; yoksa sınıfın (exe'nin) ikonu. Başlık/sistem menüsü: küçük ikon.
            IntPtr buyuk = IkonIste(h, 1), kucuk = IkonIste(h, 0);
            o.BuyukVerilmis = buyuk != IntPtr.Zero;
            o.KucukVerilmis = kucuk != IntPtr.Zero;
            if (buyuk == IntPtr.Zero) buyuk = GetClassLongPtr(h, GCLP_HICON);
            if (kucuk == IntPtr.Zero) kucuk = IkonIste(h, 2);
            if (kucuk == IntPtr.Zero) kucuk = GetClassLongPtr(h, GCLP_HICONSM);
            o.Buyuk = Olc("buyuk", buyuk, ico, karsi);
            o.Kucuk = Olc("kucuk", kucuk, ico, karsi);
            sonuc.Add(o);
        }
        return sonuc.ToArray();
    }
}
'@

if ($Kip -eq 'exe') {
  if (-not $Exe) { throw '-Exe gerekli' }
  $sonuc = [FuberIkonDenetimi]::ExeDenetle($Exe, $Ico, $Karsi)
} else {
  $tutamaclar = [long[]]@(($Hwnd -split ',') | Where-Object { $_ } | ForEach-Object { [long]$_ })
  $sonuc = [FuberIkonDenetimi]::PencereDenetle($tutamaclar, $Ico, $Karsi)
}
# Tek öğeli diziler de dizi kalsın (ConvertTo-Json tek öğeyi nesneye çevirir).
ConvertTo-Json -InputObject @($sonuc) -Depth 4 -Compress
