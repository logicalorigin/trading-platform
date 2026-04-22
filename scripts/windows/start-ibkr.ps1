<#
.SYNOPSIS
  One-click launcher for the IBKR live-data chain on Windows.

.DESCRIPTION
  Opens Client Portal Gateway (CPG) in one PowerShell window and cloudflared
  in another, watches cloudflared's output for the public *.trycloudflare.com
  hostname, and prints the formatted IBKR_BASE_URL so you only have to paste
  it into Replit Secrets.

.NOTES
  Double-click friendly. If Windows blocks execution, right-click -> "Run with
  PowerShell", or run once from an elevated prompt:
      Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>

[CmdletBinding()]
param(
    [string]$CpgPath       = (Join-Path $env:USERPROFILE 'clientportal.gw'),
    [string]$CpgConf       = 'root\conf.yaml',
    [string]$CloudflaredExe = 'cloudflared',
    [string]$LocalUrl      = 'https://localhost:5000',
    [int]   $TunnelTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

function Write-Banner([string]$Text, [ConsoleColor]$Color = 'Cyan') {
    $line = '=' * ([Math]::Max(40, $Text.Length + 4))
    Write-Host ''
    Write-Host $line -ForegroundColor $Color
    Write-Host "  $Text" -ForegroundColor $Color
    Write-Host $line -ForegroundColor $Color
    Write-Host ''
}

# ---------------------------------------------------------------------------
# 1. Sanity checks
# ---------------------------------------------------------------------------
if (-not (Test-Path $CpgPath)) {
    Write-Error "CPG directory not found: $CpgPath`nPass -CpgPath <dir> if it lives elsewhere."
}
$cpgRunBat = Join-Path $CpgPath 'bin\run.bat'
if (-not (Test-Path $cpgRunBat)) {
    Write-Error "Could not find $cpgRunBat. Is the Client Portal Gateway extracted there?"
}
if (-not (Get-Command $CloudflaredExe -ErrorAction SilentlyContinue)) {
    Write-Error "cloudflared not found on PATH. Install it from https://github.com/cloudflare/cloudflared/releases"
}

# ---------------------------------------------------------------------------
# 2. Launch CPG in its own PowerShell window
# ---------------------------------------------------------------------------
Write-Banner 'Starting Client Portal Gateway' 'Yellow'
$cpgCmd = "Set-Location -LiteralPath '$CpgPath'; & '$cpgRunBat' '$CpgConf'"
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoExit', '-NoProfile', '-Command', $cpgCmd `
    -WindowStyle Normal | Out-Null
Write-Host "CPG window launched. It will listen on $LocalUrl once ready." -ForegroundColor Green
Write-Host "Remember to log in via your browser at $LocalUrl after CPG starts." -ForegroundColor DarkYellow

# ---------------------------------------------------------------------------
# 3. Launch cloudflared in another PowerShell window with logging to a file
# ---------------------------------------------------------------------------
$logDir = Join-Path $env:TEMP 'rayalgo-ibkr'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$cfLog = Join-Path $logDir "cloudflared-$timestamp.log"

Write-Banner 'Starting cloudflared tunnel' 'Yellow'
$cfCmd = @"
& '$CloudflaredExe' tunnel --url $LocalUrl --no-tls-verify 2>&1 | Tee-Object -FilePath '$cfLog'
"@
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoExit', '-NoProfile', '-Command', $cfCmd `
    -WindowStyle Normal | Out-Null
Write-Host "cloudflared window launched. Logs streaming to $cfLog" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Watch the log for the trycloudflare.com hostname
# ---------------------------------------------------------------------------
Write-Banner "Waiting for tunnel hostname (timeout ${TunnelTimeoutSeconds}s)..." 'Cyan'

$deadline = (Get-Date).AddSeconds($TunnelTimeoutSeconds)
$tunnelHost = $null
$pattern = 'https?://([a-z0-9-]+\.trycloudflare\.com)'

while ((Get-Date) -lt $deadline -and -not $tunnelHost) {
    Start-Sleep -Milliseconds 500
    if (-not (Test-Path $cfLog)) { continue }
    $content = Get-Content -LiteralPath $cfLog -Raw -ErrorAction SilentlyContinue
    if ($content) {
        $m = [regex]::Match($content, $pattern, 'IgnoreCase')
        if ($m.Success) { $tunnelHost = $m.Groups[1].Value }
    }
}

if (-not $tunnelHost) {
    Write-Host ''
    Write-Host "Did not see a trycloudflare.com hostname within $TunnelTimeoutSeconds seconds." -ForegroundColor Red
    Write-Host "Check the cloudflared window manually. Log file: $cfLog" -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to exit'
    exit 1
}

$tunnelUrl  = "https://$tunnelHost"
$ibkrBaseUrl = "$tunnelUrl/v1/api"

# ---------------------------------------------------------------------------
# 5. Surface the URL prominently and copy to clipboard
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host ('#' * 72) -ForegroundColor Green
Write-Host ('#' + (' ' * 70) + '#') -ForegroundColor Green
Write-Host ("#   TUNNEL READY".PadRight(71) + '#') -ForegroundColor Green
Write-Host ('#' + (' ' * 70) + '#') -ForegroundColor Green
Write-Host ('#' * 72) -ForegroundColor Green
Write-Host ''
Write-Host '  Tunnel host : ' -NoNewline -ForegroundColor Gray
Write-Host $tunnelHost -ForegroundColor White
Write-Host '  Tunnel URL  : ' -NoNewline -ForegroundColor Gray
Write-Host $tunnelUrl   -ForegroundColor White
Write-Host ''
Write-Host '  Paste this into Replit Secrets as IBKR_BASE_URL:' -ForegroundColor Yellow
Write-Host ''
Write-Host "      $ibkrBaseUrl" -ForegroundColor Green
Write-Host ''

try {
    Set-Clipboard -Value $ibkrBaseUrl
    Write-Host '  (Already copied to your clipboard.)' -ForegroundColor DarkGray
} catch {
    Write-Host '  (Could not access clipboard; copy manually.)' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Open https://localhost:5000 in your browser and complete IBKR login.'
Write-Host '  2. Update IBKR_BASE_URL in Replit Secrets with the value above.'
Write-Host '  3. Leave both new PowerShell windows running for the trading session.'
Write-Host ''
Read-Host 'Press Enter to close this launcher (the CPG and cloudflared windows will keep running)'
