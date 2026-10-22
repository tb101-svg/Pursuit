# Runs Pursuit in the background: the always-on copy your installed app opens.
# Started hidden at login (Startup folder) and by the Pursuit launcher. Safe to
# run twice: if Pursuit is already running it does nothing.
#
# - Rebuilds first when the code has changed since the last build, so to pick
#   up changes just stop the running Pursuit (node) process; this restarts it.
# - Listens on your Wi-Fi only when PURSUIT_PASSCODE is set in .env.local.
# - Restarts Pursuit if it stops (up to 20 times).
# - Logs to data\logs.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Port = 3100 # must stay 3100: the Microsoft sign-in redirect points to it
$DistDir = ".next-app"
$LogDir = Join-Path $Root "data\logs"
$Log = Join-Path $LogDir "pursuit.log"
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Write-Log($message) {
  Add-Content -Path $Log -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding utf8
}

function Test-Running {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# Runs node with its output in data\logs\<name>.out.log / .err.log; returns the exit code.
function Invoke-Node($name, [string[]]$arguments) {
  $out = Join-Path $LogDir "$name.out.log"
  $err = Join-Path $LogDir "$name.err.log"
  foreach ($f in @($out, $err)) { if (Test-Path $f) { Move-Item $f "$f.old" -Force } }
  $p = Start-Process -FilePath $script:node -ArgumentList $arguments -WorkingDirectory $Root -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  return $p.ExitCode
}

if (Test-Running) { exit 0 }

# Only one copy of this script at a time (login and the launcher can race).
$mutex = New-Object System.Threading.Mutex($false, "Local\PursuitServer")
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 1MB) { Move-Item $Log "$Log.old" -Force }

  $script:node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $script:node) { Write-Log "Node.js not found. Install it from nodejs.org."; exit 1 }
  $next = Join-Path $Root "node_modules\next\dist\bin\next"
  if (-not (Test-Path $next)) {
    Write-Log "Installing dependencies..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm install" -WorkingDirectory $Root -NoNewWindow -Wait | Out-Null
  }

  $env:PURSUIT_DIST_DIR = $DistDir
  $env:NEXT_TELEMETRY_DISABLED = "1"
  $hostName = "127.0.0.1"
  $envFile = Join-Path $Root ".env.local"
  if ((Test-Path $envFile) -and (Select-String -Path $envFile -Pattern "^PURSUIT_PASSCODE=.+" -Quiet)) { $hostName = "0.0.0.0" }

  for ($attempt = 1; $attempt -le 20; $attempt++) {
    # Rebuild when anything the app is built from is newer than the last build.
    $buildId = Join-Path $Root "$DistDir\BUILD_ID"
    $sources = @()
    foreach ($dir in @("src", "public")) { $sources += Get-ChildItem (Join-Path $Root $dir) -Recurse -File -ErrorAction SilentlyContinue }
    foreach ($file in @("next.config.ts", "package-lock.json", "tsconfig.json", "postcss.config.mjs")) { $sources += Get-Item (Join-Path $Root $file) -ErrorAction SilentlyContinue }
    $newest = ($sources | Measure-Object LastWriteTime -Maximum).Maximum
    if (-not (Test-Path $buildId) -or (Get-Item $buildId).LastWriteTime -lt $newest) {
      Write-Log "Building Pursuit (the code changed since the last build)..."
      $code = Invoke-Node "build" @("`"$next`"", "build")
      if ($code -ne 0) { Write-Log "Build failed (exit $code); see data\logs\build.err.log and build.out.log." }
      if (-not (Test-Path $buildId)) { exit 1 }
    }

    if (Test-Running) { break } # another copy took over
    $where = if ($hostName -eq "0.0.0.0") { "this computer and your Wi-Fi" } else { "this computer only" }
    Write-Log "Starting Pursuit on port $Port ($where)"
    $code = Invoke-Node "server" @("`"$next`"", "start", "--port", "$Port", "--hostname", $hostName)
    Write-Log "Pursuit stopped (exit $code)."
    Start-Sleep -Seconds 3
  }
}
finally {
  $mutex.ReleaseMutex()
}
