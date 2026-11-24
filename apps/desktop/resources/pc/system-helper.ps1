# Fuber AI 2 - system helper (pc module: master volume, brightness, lock, power).
#
# This file is intentionally ASCII-only: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI, and a
# mangled multi-byte character inside the C# source below would break compilation.
#
# One-shot: one invocation = one operation = one JSON object on a single stdout line.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File system-helper.ps1 -Op volume-get
#   -> {"ok":true,"op":"volume-get","level":42,"muted":false}
#   -> {"ok":false,"op":"...","error":"..."}
#
# Ops:
#   volume-get                       read master volume (0-100) and mute state of the default output device
#   volume-set   -Level 0..100       set master volume
#   mute-set     -Muted 0|1          mute / unmute
#   brightness-get                   read internal display brightness (WMI); {"supported":false} on desktop monitors
#   brightness-set -Level 0..100     set internal display brightness
#   lock                             lock the workstation
#   power -Action sleep|shutdown|restart|cancel [-Delay seconds]
#                                    sleep: waits Delay then suspends; shutdown/restart: shutdown.exe /t Delay
#                                    (the user sees the Windows countdown and can still cancel); cancel: shutdown.exe /a
#
# -DryRun: every CHANGING op (volume-set, mute-set, brightness-set, lock, power) does nothing and reports what it
#          would have done: {"ok":true,"dryRun":true,"would":"..."}. Read ops ignore the switch.
#
# The JSON line is written BEFORE a blocking action (sleep) so the caller never waits for the machine to wake up.
param(
  [Parameter(Mandatory = $true)][string]$Op,
  [int]$Level = -1,
  [int]$Muted = -1,
  [string]$Action = '',
  [int]$Delay = 60,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Out-Json($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

function Fail($message) {
  Out-Json @{ ok = $false; op = $Op; error = [string]$message }
  exit 1
}

function Would($text) {
  Out-Json @{ ok = $true; op = $Op; dryRun = $true; would = [string]$text }
  exit 0
}

$source = @'
using System;
using System.Runtime.InteropServices;

namespace FuberSys
{
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint count);
        int SetMasterVolumeLevel(float levelDb, ref Guid context);
        int SetMasterVolumeLevelScalar(float level, ref Guid context);
        int GetMasterVolumeLevel(out float levelDb);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        int GetChannelVolumeLevel(uint channel, out float levelDb);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    public static class Audio
    {
        // eRender = 0, eMultimedia = 1: the device the user hears media on.
        static IAudioEndpointVolume Endpoint()
        {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object instance;
            // CLSCTX_ALL = 23
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out instance));
            return (IAudioEndpointVolume)instance;
        }

        public static int Level()
        {
            float level;
            Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out level));
            return (int)Math.Round(level * 100.0);
        }

        public static bool Muted()
        {
            bool mute;
            Marshal.ThrowExceptionForHR(Endpoint().GetMute(out mute));
            return mute;
        }

        public static void SetLevel(int percent)
        {
            Guid context = Guid.Empty;
            float level = Math.Max(0, Math.Min(100, percent)) / 100f;
            Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(level, ref context));
        }

        public static void SetMuted(bool mute)
        {
            Guid context = Guid.Empty;
            Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute, ref context));
        }
    }

    public static class Session
    {
        [DllImport("user32.dll", SetLastError = true)] public static extern bool LockWorkStation();
        [DllImport("powrprof.dll", SetLastError = true)] public static extern bool SetSuspendState(bool hibernate, bool force, bool wakeupEventsDisabled);
    }
}
'@

function Load-Native {
  if (-not ('FuberSys.Audio' -as [type])) { Add-Type -TypeDefinition $source -Language CSharp }
}

function Volume-State {
  return @{ ok = $true; op = $Op; level = [FuberSys.Audio]::Level(); muted = [FuberSys.Audio]::Muted() }
}

function Brightness-State {
  try {
    $monitor = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
  } catch {
    return @{ ok = $true; op = $Op; supported = $false; level = $null }
  }
  if ($null -eq $monitor) { return @{ ok = $true; op = $Op; supported = $false; level = $null } }
  return @{ ok = $true; op = $Op; supported = $true; level = [int]$monitor.CurrentBrightness }
}

$shutdownExe = Join-Path $env:SystemRoot 'System32\shutdown.exe'

# Runs shutdown.exe without a console window and returns its exit code (no stderr redirection: with
# ErrorActionPreference=Stop a native stderr line would become a terminating error in PowerShell 5.1).
function Invoke-Shutdown([string[]]$arguments) {
  $process = Start-Process -FilePath $shutdownExe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  return [int]$process.ExitCode
}

try {
  switch ($Op) {
    'volume-get' {
      Load-Native
      Out-Json (Volume-State)
    }
    'volume-set' {
      if ($Level -lt 0 -or $Level -gt 100) { Fail 'level must be 0..100' }
      if ($DryRun) { Would "volume-set $Level" }
      Load-Native
      [FuberSys.Audio]::SetLevel($Level)
      Out-Json (Volume-State)
    }
    'mute-set' {
      if ($Muted -ne 0 -and $Muted -ne 1) { Fail 'muted must be 0 or 1' }
      if ($DryRun) { Would "mute-set $Muted" }
      Load-Native
      [FuberSys.Audio]::SetMuted($Muted -eq 1)
      Out-Json (Volume-State)
    }
    'brightness-get' {
      Out-Json (Brightness-State)
    }
    'brightness-set' {
      if ($Level -lt 0 -or $Level -gt 100) { Fail 'level must be 0..100' }
      if ($DryRun) { Would "brightness-set $Level" }
      $methods = $null
      try {
        $methods = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
      } catch {
        $methods = $null
      }
      if ($null -eq $methods) {
        Out-Json @{ ok = $true; op = $Op; supported = $false; level = $null }
      } else {
        Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$Level } | Out-Null
        Start-Sleep -Milliseconds 150
        Out-Json (Brightness-State)
      }
    }
    'lock' {
      if ($DryRun) { Would 'lock' }
      Load-Native
      if (-not [FuberSys.Session]::LockWorkStation()) { Fail 'LockWorkStation failed' }
      Out-Json @{ ok = $true; op = $Op; locked = $true }
    }
    'power' {
      if ($Delay -lt 0 -or $Delay -gt 3600) { Fail 'delay must be 0..3600' }
      switch ($Action) {
        'sleep' {
          if ($DryRun) { Would "power sleep delay=$Delay" }
          Load-Native
          Out-Json @{ ok = $true; op = $Op; action = 'sleep'; scheduled = $true; delay = $Delay }
          if ($Delay -gt 0) { Start-Sleep -Seconds $Delay }
          [FuberSys.Session]::SetSuspendState($false, $false, $false) | Out-Null
        }
        'shutdown' {
          if ($DryRun) { Would "power shutdown delay=$Delay ($shutdownExe /s /t $Delay)" }
          $code = Invoke-Shutdown @('/s', '/t', "$Delay")
          if ($code -ne 0) { Fail "shutdown.exe exit $code" }
          Out-Json @{ ok = $true; op = $Op; action = 'shutdown'; scheduled = $true; delay = $Delay }
        }
        'restart' {
          if ($DryRun) { Would "power restart delay=$Delay ($shutdownExe /r /t $Delay)" }
          $code = Invoke-Shutdown @('/r', '/t', "$Delay")
          if ($code -ne 0) { Fail "shutdown.exe exit $code" }
          Out-Json @{ ok = $true; op = $Op; action = 'restart'; scheduled = $true; delay = $Delay }
        }
        'cancel' {
          if ($DryRun) { Would "power cancel ($shutdownExe /a)" }
          $code = Invoke-Shutdown @('/a')
          # 1116 = no shutdown was in progress: nothing to cancel is not a failure of the helper.
          if ($code -eq 1116) { Out-Json @{ ok = $true; op = $Op; action = 'cancel'; pending = $false } }
          elseif ($code -ne 0) { Fail "shutdown.exe exit $code" }
          else { Out-Json @{ ok = $true; op = $Op; action = 'cancel'; pending = $true } }
        }
        default { Fail "unknown action: $Action" }
      }
    }
    default { Fail "unknown op: $Op" }
  }
} catch {
  Fail $_.Exception.Message
}
