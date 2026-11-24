param([int]$BostaSaniye = 45, [int]$EnUzunSaat = 14)
# Oturum açılana VE kullanıcı en az $BostaSaniye sn fareye/klavyeye dokunmayana dek bekler (gerçek girdi testleri
# kullanıcıyı rahatsız etmesin). Çıkış 0 = koşullar sağlandı, 2 = süre doldu.
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Bosta {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static double Saniye() { var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.dwTime) / 1000.0; }
}
'@
$bitis = (Get-Date).AddHours($EnUzunSaat)
while ((Get-Date) -lt $bitis) {
  $kilitli = [bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)
  if (-not $kilitli -and [Bosta]::Saniye() -ge $BostaSaniye) { Write-Output "acik ve bosta $(Get-Date -Format 'HH:mm:ss')"; exit 0 }
  Start-Sleep -Seconds 20
}
Write-Output 'sure doldu'; exit 2
