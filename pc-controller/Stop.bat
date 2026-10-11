@echo off
setlocal

set "CONTROLLER_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$pidFile = Join-Path $env:CONTROLLER_DIR '.pc-controller.pid';" ^
  "if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'PC controller is not running (PID file missing).'; exit 0 };" ^
  "try { $marker = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json } catch { Write-Host 'PID file is unreadable; refusing to stop any process.'; exit 1 };" ^
  "$expectedDir = [IO.Path]::GetFullPath($env:CONTROLLER_DIR).TrimEnd([char[]]@('\'));" ^
  "if ([IO.Path]::GetFullPath([string]$marker.directory).TrimEnd([char[]]@('\')) -ine $expectedDir) { Write-Host 'PID file points to a different folder; refusing to stop any process.'; exit 1 };" ^
  "$proc = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$marker.pid) -ErrorAction SilentlyContinue;" ^
  "if (-not $proc) { Remove-Item -LiteralPath $pidFile -Force; Write-Host 'Controller is not running; removed stale PID file.'; exit 0 };" ^
  "$started = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$marker.startedAt).UtcDateTime;" ^
  "$created = $proc.CreationDate.ToUniversalTime();" ^
  "if ($proc.Name -notin @('node.exe', 'node') -or $proc.CommandLine -notmatch 'pc\.js' -or [Math]::Abs(($created - $started).TotalSeconds) -gt 15) { Write-Host 'PID does not match this controller instance; refusing to stop it.'; exit 1 };" ^
  "Stop-Process -Id ([int]$marker.pid) -Force;" ^
  "Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue;" ^
  "Write-Host 'Stopped the Bitburner PC controller.'"

if errorlevel 1 pause
