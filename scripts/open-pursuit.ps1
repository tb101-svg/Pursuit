# Opens Pursuit: starts it in the background if it isn't running, waits until
# it's ready, then opens your installed Pursuit app (or your browser).
# The desktop and Start menu Pursuit shortcuts run this, hidden.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Port = 3100
$Url = "http://localhost:$Port"

function Test-Ready {
  try {
    (Invoke-WebRequest -Uri "$Url/manifest.webmanifest" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
  } catch {
    $false
  }
}

if (-not (Test-Ready)) {
  # Start the server script on its own, so it keeps running after this closes.
  Start-Process -FilePath "conhost.exe" -WindowStyle Hidden -ArgumentList @(
    "--headless", "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Root\scripts\pursuit-server.ps1`""
  )
  # A rebuild after code changes can take a couple of minutes; a normal start takes seconds.
  $deadline = (Get-Date).AddMinutes(4)
  while (-not (Test-Ready) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 700 }
}

# Open the installed app (Brave, Chrome or Edge "install as app"), else the browser.
$appShortcut = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Brave Apps\Pursuit.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Chrome Apps\Pursuit.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Edge Apps\Pursuit.lnk"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($appShortcut) {
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($appShortcut)
  if ($link.TargetPath -notmatch "conhost") {
    Start-Process -FilePath $link.TargetPath -ArgumentList $link.Arguments
    exit 0
  }
}
Start-Process $Url
