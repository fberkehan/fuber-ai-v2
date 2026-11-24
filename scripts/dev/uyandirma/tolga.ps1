param([string]$Klasor, [string]$Liste)
# Microsoft Tolga (OneCore, tr-TR) ile WAV üretir: her satır "ad|ssml-gövdesi"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Bekle($Islem, $Tur) { $t = $asTask.MakeGenericMethod($Tur).Invoke($null, @($Islem)); $t.Wait(-1) | Out-Null; $t.Result }
$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$s.Voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq 'tr-TR' } | Select-Object -First 1
New-Item -ItemType Directory -Force $Klasor | Out-Null
foreach ($satir in Get-Content -Encoding UTF8 $Liste) {
  if (-not $satir.Trim()) { continue }
  $ad, $govde = $satir -split '\|', 2
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='tr-TR'><break time='700ms'/>$govde<break time='1500ms'/></speak>"
  $akis = Bekle ($s.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $okuyucu = New-Object Windows.Storage.Streams.DataReader($akis.GetInputStreamAt(0))
  $null = Bekle ($okuyucu.LoadAsync([uint32]$akis.Size)) ([uint32])
  $bayt = New-Object byte[] ([int]$akis.Size)
  $okuyucu.ReadBytes($bayt)
  [IO.File]::WriteAllBytes((Join-Path $Klasor "$ad.wav"), $bayt)
}
Write-Output "ses: $($s.Voice.DisplayName)"
