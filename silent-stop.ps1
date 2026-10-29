# Silent stop: stops bridge + brain + pet (optionally NapCat) and pauses the watchdog.
# NOTE: keep this file ASCII-only (see silent-launch.ps1).
param([switch]$IncludeNapCat)

$ErrorActionPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$petState = Join-Path $here '..\pet\state'
$logFile = Join-Path $here 'logs\launcher.log'

function Log($msg) {
  Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
}

function Stop-ByPidFile($file, $name) {
  if (-not (Test-Path $file)) { return }
  $raw = (Get-Content $file -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($raw) {
    try {
      Stop-Process -Id ([int]$raw) -Force -ErrorAction Stop
      Log ("stopped $name (pid $raw)")
    } catch {
      Log ("could not stop $name (pid $raw): " + $_.Exception.Message)
    }
  }
  Remove-Item $file -Force -ErrorAction SilentlyContinue
}

# Kill by pid file first (exact), then fall back to command-line matching.
Stop-ByPidFile (Join-Path $here 'state\bridge.lock') 'bridge'
Stop-ByPidFile (Join-Path $petState 'brain.pid') 'brain'
Stop-ByPidFile (Join-Path $petState 'pet.pid') 'pet'

Get-CimInstance Win32_Process -Filter "Name='node.exe' AND (CommandLine LIKE '%bridge.mjs%' OR CommandLine LIKE '%brain.mjs%')" |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' AND CommandLine LIKE '%pet.py%'" |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if ($IncludeNapCat) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe' AND (CommandLine LIKE '%napcat%' OR CommandLine LIKE '%NapCat.Shell%')" |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

Remove-Item (Join-Path $here 'state\bridge.lock') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $petState 'brain.pid') -Force -ErrorAction SilentlyContinue

# Pause switch for the watchdog.
$flag = Join-Path $here 'state\paused.flag'
[System.IO.File]::WriteAllText($flag, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (New-Object System.Text.UTF8Encoding($false)))
Log 'stopped; watchdog paused (run the launcher to resume)'
