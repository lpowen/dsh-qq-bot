# Silent launcher: starts NapCat, brain, bridge and the pet with no console windows.
# Called by the .vbs wrappers (hidden PowerShell); all output goes to log files.
# Safe to run repeatedly: every step checks whether the thing is already alive.
# NOTE: keep this file ASCII-only. Windows PowerShell reads UTF-8 without BOM as ANSI,
#       and non-ASCII comments can swallow the next line.
$ErrorActionPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$petDir = Join-Path $here '..\pet'
$node = 'C:\Program Files\nodejs\node.exe'
$pythonw = '$(Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\pythonw.exe')'
$napcat = 'D:\NapCat\start-napcat.cmd'

# Pause switch: the stop script writes this file; while it exists nothing is started.
$paused = Join-Path $here 'state\paused.flag'
if (Test-Path $paused) { exit 0 }

function Test-Port($p) {
  return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path (Join-Path $here 'logs\launcher.log') -Value $line -Encoding UTF8
}

# 1) NapCat (QQ side)
if (-not (Test-Port 6099)) {
  if (Test-Path $napcat) {
    Log 'starting NapCat'
    Start-Process -FilePath $napcat -WindowStyle Hidden
    Start-Sleep -Seconds 12
  }
}

# 2) brain (memory / proactive)
if (-not (Test-Port 4399)) {
  Log 'starting brain'
  Start-Process -FilePath $node -ArgumentList 'brain.mjs' -WorkingDirectory $petDir -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# 3) bridge (QQ <-> DSH), guarded by its own lock file
$lock = Join-Path $here 'state\bridge.lock'
$needBridge = $true
if (Test-Path $lock) {
  $old = Get-Content $lock -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue)) { $needBridge = $false }
}
if ($needBridge) {
  Log 'starting bridge'
  Start-Process -FilePath $node -ArgumentList 'bridge.mjs' -WorkingDirectory $here -WindowStyle Hidden
}

# 4) desktop pet  (skip if the user quit it on purpose; manual launcher clears the flag)
$petStopped = Join-Path $petDir 'state\pet.stopped'
$petRunning = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" |
  Where-Object { $_.CommandLine -like '*pet.py*' }
if (-not (Test-Path $petStopped) -and -not $petRunning) {
  Log 'starting pet'
  Start-Process -FilePath $pythonw -ArgumentList 'pet.py' -WorkingDirectory $petDir -WindowStyle Hidden
}
