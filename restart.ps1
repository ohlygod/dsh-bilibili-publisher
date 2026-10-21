# Restart DeepSeek Harness.
# Launched via WMI so it survives the parent process being killed.
# ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM.
param(
  [string]$Exe = "D:\SoftWare\DSH\DeepSeek Harness.exe",
  [string]$Log = "$env:TEMP\dsh-restart.log",
  [int]$WaitMs = 2000,
  [switch]$DryRun
)

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'HH:mm:ss.fff')  $msg"
  Add-Content -Path $Log -Value $line -Encoding UTF8
}

Write-Log "restart script started (DryRun=$DryRun)"
Write-Log "exe = $Exe"
Write-Log "exe exists = $(Test-Path $Exe)"

Start-Sleep -Milliseconds $WaitMs
Write-Log "woke up, enumerating processes"

$procs = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
Write-Log "found $($procs.Count) DSH processes: $(($procs | ForEach-Object { $_.Id }) -join ',')"

if ($DryRun) {
  Write-Log "DRY RUN: not killing anything"
  exit 0
}

foreach ($p in $procs) {
  try {
    $p.Kill()
    Write-Log "killed $($p.Id)"
  } catch {
    Write-Log "kill failed $($p.Id): $($_.Exception.Message)"
  }
}

Write-Log "waiting for exit"
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  $left = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) { break }
  Start-Sleep -Milliseconds 300
}

$left = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
Write-Log "remaining after wait: $($left.Count)"

Start-Sleep -Milliseconds 800

if (Test-Path $Exe) {
  try {
    Start-Process -FilePath $Exe
    Write-Log "relaunched OK"
  } catch {
    Write-Log "relaunch FAILED: $($_.Exception.Message)"
  }
} else {
  Write-Log "exe missing, cannot relaunch"
}

Write-Log "restart script done"
