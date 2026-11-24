# Gerçek pencere ölçümü (0.13 T16): ada-gercek-pencere.mjs bu süreci açar, stdin'den satır satır komut verir, stdout'tan tek satır JSON alır.
# YALNIZ test: verilen pencere tutamacına bakar ya da ona ileti yollar; imleci oynatmaz, odak almaz, başka pencereye dokunmaz.
#   stil <hwnd>                 WS_EX_* bayrakları (TRANSPARENT, LAYERED, NOACTIVATE) ve görünürlük
#   nokta <x> <y>               WindowFromPoint: işletim sisteminin o noktadaki isabet testi (hangi üst düzey pencere tıklamayı alır)
#   arka <hwnd>                 DWMWA_SYSTEMBACKDROP_TYPE (0 auto, 1 none, 2 mica, 3 acrylic, 4 tabbed)
#   cocuk <hwnd>                Chrome_RenderWidgetHostHWND alt penceresi (Electron'un hover iletmesinin hedefi)
#   kutu <hwnd>                 GetWindowRect (bu sürecin DPI görünümünde: DPI'dan habersiz PowerShell'de birincil ekranın ölçeğiyle sanallaştırılmış olabilir)
#   fkutu <hwnd>                GetWindowRect, ekran başına DPI farkında iş parçacığından (gerçek fiziksel piksel; 0.14 T28, --olcek denetimi)
#   fnokta <x> <y>              WindowFromPoint, ekran başına DPI farkında iş parçacığından (fiziksel piksel; 0.14 T28 düzeltme turu 1)
#   fare <hwnd> <x> <y>         WM_MOUSEMOVE (istemci koordinatı)
#   ayril <hwnd>                WM_MOUSELEAVE
#   tikla <hwnd> <x> <y>        WM_LBUTTONDOWN + WM_LBUTTONUP
#   surukle <hwnd> <x> <y>      WM_MOUSEMOVE, wParam = MK_LBUTTON (0.14 T27, R21: sol düğme basılıyken gelen fare hareketi — dışarıdan sürüklenen nesne)
# 0.14 T28 düzeltme turu 2: fare, ayril, tikla, surukle iletileri ekran başına DPI farkında (PMv2) iş parçacığından yollanır (`Gonder`). PowerShell'in varsayılan
# (sistem DPI'ı, %150) bağlamından yollanan fare iletisinin koordinatını Windows sanallaştırıyordu: %150'lik ekrandaki pencerede sayfaya 1:1 düşüyordu (oran 1,
# ölçek 1,5 iken). PMv2'den yollanan koordinat fiziksel pikseldir: Chromium onu ekranın ölçeğine böler, istemci koordinatı = CSS px × ölçek (ada-gercek-pencere
# bu ilişkiyi `oran === D'nin ölçeği` diye doğrular).
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Olc {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  public delegate bool Geri(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, Geri c, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static bool Gonder(IntPtr h, uint m, IntPtr w, IntPtr l) {
    IntPtr eski = SetThreadDpiAwarenessContext((IntPtr)(-4));
    bool t = PostMessageW(h, m, w, l);
    if (eski != IntPtr.Zero) SetThreadDpiAwarenessContext(eski);
    return t;
  }
  public static IntPtr FizikselNokta(int x, int y) {
    IntPtr eski = SetThreadDpiAwarenessContext((IntPtr)(-4));
    POINT n; n.X = x; n.Y = y;
    IntPtr k = GetAncestor(WindowFromPoint(n), 2);
    if (eski != IntPtr.Zero) SetThreadDpiAwarenessContext(eski);
    return k;
  }
  public static RECT FizikselKutu(IntPtr h) {
    IntPtr eski = SetThreadDpiAwarenessContext((IntPtr)(-4)); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    RECT r; GetWindowRect(h, out r);
    if (eski != IntPtr.Zero) SetThreadDpiAwarenessContext(eski);
    return r;
  }
  public static IntPtr Cocuk(IntPtr p, string sinif) {
    IntPtr bulunan = IntPtr.Zero;
    EnumChildWindows(p, (h, l) => { var s = new StringBuilder(128); GetClassNameW(h, s, 128); if (s.ToString() == sinif) { bulunan = h; return false; } return true; }, IntPtr.Zero);
    return bulunan;
  }
  public static IntPtr Lparam(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }
}
'@
$cikis = [Console]::Out
while ($null -ne ($satir = [Console]::In.ReadLine())) {
  $p = $satir.Trim() -split '\s+'
  try {
    switch ($p[0]) {
      'stil' {
        $h = [IntPtr][long]$p[1]
        $ex = [long](([Olc]::GetWindowLongPtr($h, -20)).ToInt64())
        $sonuc = @{ ex = $ex; saydam = (($ex -band 0x20) -ne 0); katmanli = (($ex -band 0x80000) -ne 0); etkinlesmez = (($ex -band 0x8000000) -ne 0); gorunur = [Olc]::IsWindowVisible($h) }
      }
      'nokta' {
        $n = New-Object Olc+POINT; $n.X = [int]$p[1]; $n.Y = [int]$p[2]
        $w = [Olc]::WindowFromPoint($n)
        $k = [Olc]::GetAncestor($w, 2)
        $sonuc = @{ hwnd = $k.ToInt64() }
      }
      'arka' {
        $h = [IntPtr][long]$p[1]; $v = -1
        $hr = [Olc]::DwmGetWindowAttribute($h, 38, [ref]$v, 4)
        $sonuc = @{ hr = $hr; tur = $v }
      }
      'kutu' {
        $k = New-Object Olc+RECT
        [void][Olc]::GetWindowRect([IntPtr][long]$p[1], [ref]$k)
        $sonuc = @{ sol = $k.Left; ust = $k.Top; sag = $k.Right; alt = $k.Bottom }
      }
      'fnokta' { $sonuc = @{ hwnd = ([Olc]::FizikselNokta([int]$p[1], [int]$p[2])).ToInt64() } }
      'fkutu' {
        $k = [Olc]::FizikselKutu([IntPtr][long]$p[1])
        $sonuc = @{ sol = $k.Left; ust = $k.Top; sag = $k.Right; alt = $k.Bottom }
      }
      'cocuk' { $sonuc = @{ hwnd = ([Olc]::Cocuk([IntPtr][long]$p[1], 'Chrome_RenderWidgetHostHWND')).ToInt64() } }
      'fare' { $sonuc = @{ tamam = [Olc]::Gonder([IntPtr][long]$p[1], 0x0200, [IntPtr]::Zero, [Olc]::Lparam([int]$p[2], [int]$p[3])) } }
      'surukle' { $sonuc = @{ tamam = [Olc]::Gonder([IntPtr][long]$p[1], 0x0200, [IntPtr]1, [Olc]::Lparam([int]$p[2], [int]$p[3])) } }
      'ayril' { $sonuc = @{ tamam = [Olc]::Gonder([IntPtr][long]$p[1], 0x02A3, [IntPtr]::Zero, [IntPtr]::Zero) } }
      'tikla' {
        $h = [IntPtr][long]$p[1]; $l = [Olc]::Lparam([int]$p[2], [int]$p[3])
        $a = [Olc]::Gonder($h, 0x0201, [IntPtr]1, $l); $b = [Olc]::Gonder($h, 0x0202, [IntPtr]::Zero, $l)
        $sonuc = @{ tamam = ($a -and $b) }
      }
      default { $sonuc = @{ hata = "bilinmeyen komut: $($p[0])" } }
    }
  } catch { $sonuc = @{ hata = "$_" } }
  $cikis.WriteLine(($sonuc | ConvertTo-Json -Compress))
  $cikis.Flush()
}
