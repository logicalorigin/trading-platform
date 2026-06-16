<#
.SYNOPSIS
  Starts the RayAlgo IBKR bridge beside IB Gateway/TWS on Windows.

.DESCRIPTION
  Runs artifacts/ibkr-bridge against the local TWS/IB Gateway socket and
  exposes only the bridge HTTP API through cloudflared. Replit should call this
  bridge URL with IBKR_BRIDGE_API_TOKEN. Do not expose the raw TWS socket.
#>

[CmdletBinding()]
param(
    [string]$CloudflaredExe = 'cloudflared',
    [string]$NodeExe = 'node',
    [string]$TwsHost = '127.0.0.1',
    [int]$TwsPort = 4001,
    [int]$ClientId = 101,
    [ValidateSet('paper', 'live')]
    [string]$Mode = 'live',
    [ValidateRange(1, 4)]
    [int]$MarketDataType = 1,
    [int]$BridgePort = 3002,
    [string]$AccountId = $env:IBKR_ACCOUNT_ID,
    [string]$BridgeToken = $env:IBKR_BRIDGE_API_TOKEN,
    [string]$NamedTunnel = '',
    [string]$TunnelHost = '',
    [int]$TunnelTimeoutSeconds = 60
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

function Quote-Ps([string]$Value) {
    return "'" + ($Value -replace "'", "''") + "'"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$bridgeDistPath = Join-Path $repoRoot 'artifacts\ibkr-bridge\dist\index.mjs'
$localBridgeUrl = "http://localhost:$BridgePort"

if (-not (Get-Command $NodeExe -ErrorAction SilentlyContinue)) {
    Write-Error "node not found on PATH. Install Node.js or pass -NodeExe <path>."
}
if (-not (Get-Command $CloudflaredExe -ErrorAction SilentlyContinue)) {
    Write-Error "cloudflared not found on PATH. Install it or pass -CloudflaredExe <path>."
}
if (-not (Test-Path $bridgeDistPath)) {
    Write-Error "Bridge bundle not found: $bridgeDistPath`nRun pnpm --filter @workspace/ibkr-bridge build first."
}

if (-not $BridgeToken) {
    $BridgeToken = [guid]::NewGuid().ToString('N')
}

Write-Banner "Checking IB Gateway/TWS socket $TwsHost`:$TwsPort" 'Yellow'
try {
    $socketCheck = Test-NetConnection -ComputerName $TwsHost -Port $TwsPort -WarningAction SilentlyContinue
    if (-not $socketCheck.TcpTestSucceeded) {
        Write-Host "Could not connect to $TwsHost`:$TwsPort yet." -ForegroundColor DarkYellow
        Write-Host "Start IB Gateway/TWS, enable API socket clients, then leave it running." -ForegroundColor DarkYellow
    } else {
        Write-Host "TWS socket is reachable." -ForegroundColor Green
    }
} catch {
    Write-Host "Skipped socket check: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

Write-Banner 'Starting RayAlgo IBKR bridge' 'Yellow'
$bridgeCmd = @"
Set-Location -LiteralPath $(Quote-Ps $repoRoot)
`$env:PORT = $(Quote-Ps ([string]$BridgePort))
`$env:LOG_LEVEL = 'warn'
`$env:IBKR_TRANSPORT = 'tws'
`$env:IBKR_TWS_HOST = $(Quote-Ps $TwsHost)
`$env:IBKR_TWS_PORT = $(Quote-Ps ([string]$TwsPort))
`$env:IBKR_TWS_CLIENT_ID = $(Quote-Ps ([string]$ClientId))
`$env:IBKR_TWS_MODE = $(Quote-Ps $Mode)
`$env:IBKR_TWS_MARKET_DATA_TYPE = $(Quote-Ps ([string]$MarketDataType))
`$env:IBKR_BRIDGE_API_TOKEN = $(Quote-Ps $BridgeToken)
if ($(Quote-Ps $AccountId)) { `$env:IBKR_ACCOUNT_ID = $(Quote-Ps $AccountId) }
& $(Quote-Ps $NodeExe) --enable-source-maps $(Quote-Ps $bridgeDistPath)
"@
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoExit', '-NoProfile', '-Command', $bridgeCmd `
    -WindowStyle Normal | Out-Null
Write-Host "Bridge window launched at $localBridgeUrl." -ForegroundColor Green

$logDir = Join-Path $env:TEMP 'rayalgo-ibkr'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$cfLog = Join-Path $logDir "cloudflared-tws-bridge-$timestamp.log"

Write-Banner 'Starting cloudflared tunnel for bridge' 'Yellow'
if ($NamedTunnel) {
    $cfCmd = "& $(Quote-Ps $CloudflaredExe) tunnel run $(Quote-Ps $NamedTunnel) 2>&1 | Tee-Object -FilePath $(Quote-Ps $cfLog)"
} else {
    $cfCmd = "& $(Quote-Ps $CloudflaredExe) tunnel --url $(Quote-Ps $localBridgeUrl) 2>&1 | Tee-Object -FilePath $(Quote-Ps $cfLog)"
}
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoExit', '-NoProfile', '-Command', $cfCmd `
    -WindowStyle Normal | Out-Null

$bridgeUrl = ''
if ($TunnelHost) {
    $bridgeUrl = if ($TunnelHost.StartsWith('http')) { $TunnelHost } else { "https://$TunnelHost" }
} elseif (-not $NamedTunnel) {
    Write-Banner "Waiting for quick tunnel hostname (timeout ${TunnelTimeoutSeconds}s)..." 'Cyan'
    $deadline = (Get-Date).AddSeconds($TunnelTimeoutSeconds)
    $pattern = 'https?://([a-z0-9-]+\.trycloudflare\.com)'
    while ((Get-Date) -lt $deadline -and -not $bridgeUrl) {
        Start-Sleep -Milliseconds 500
        if (-not (Test-Path $cfLog)) { continue }
        $content = Get-Content -LiteralPath $cfLog -Raw -ErrorAction SilentlyContinue
        if ($content) {
            $m = [regex]::Match($content, $pattern, 'IgnoreCase')
            if ($m.Success) { $bridgeUrl = "https://$($m.Groups[1].Value)" }
        }
    }
}

Write-Banner 'Replit Secrets' 'Green'
Write-Host 'Set these in Replit Secrets for TWS-primary mode:' -ForegroundColor Yellow
Write-Host ''
Write-Host 'IBKR_TRANSPORT=tws'
if ($bridgeUrl) {
    Write-Host "IBKR_BRIDGE_URL=$bridgeUrl"
} else {
    Write-Host 'IBKR_BRIDGE_URL=https://<your named bridge tunnel hostname>'
}
Write-Host "IBKR_BRIDGE_API_TOKEN=$BridgeToken"
Write-Host ''
Write-Host 'Optional line-budget overrides:'
Write-Host 'IBKR_MAX_LIVE_EQUITY_LINES=80'
Write-Host 'IBKR_MAX_LIVE_OPTION_LINES=20'
Write-Host ''
Write-Host 'Leave IB Gateway/TWS, the bridge window, and the cloudflared window running.' -ForegroundColor Cyan

try {
    $copyValue = "IBKR_TRANSPORT=tws`nIBKR_BRIDGE_URL=$bridgeUrl`nIBKR_BRIDGE_API_TOKEN=$BridgeToken"
    Set-Clipboard -Value $copyValue
    Write-Host '(Copied the Replit secret block to your clipboard.)' -ForegroundColor DarkGray
} catch {
    Write-Host '(Could not access clipboard; copy manually.)' -ForegroundColor DarkGray
}

Read-Host 'Press Enter to close this launcher'
