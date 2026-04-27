<#
.SYNOPSIS
  Installs and launches the RayAlgo IB Gateway bridge on Windows.

.DESCRIPTION
  This is the lowest-touch bootstrap for a Windows machine running IB Gateway
  or TWS. It installs missing prerequisites with winget when possible, clones
  the RayAlgo repo, builds the IBKR bridge, and starts the bridge launcher.
#>

[CmdletBinding()]
param(
    [ValidateSet('live', 'paper')]
    [string]$Mode = 'live',
    [string]$RepoUrl = 'https://github.com/logicalorigin/trading-platform.git',
    [string]$Branch = 'ibgateway-bridge-launcher-20260427',
    [string]$RepoDir = (Join-Path $env:USERPROFILE 'rayalgo-trading-platform')
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text, [ConsoleColor]$Color = 'Cyan') {
    Write-Host ''
    Write-Host "==> $Text" -ForegroundColor $Color
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

function Ensure-Command([string]$Command, [string]$WingetId, [string]$DisplayName) {
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        return
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$DisplayName is required, but '$Command' was not found and winget is not available."
    }

    Write-Step "Installing $DisplayName"
    winget install --id $WingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$DisplayName installed, but '$Command' is still not on PATH. Open a new PowerShell window and rerun this script."
    }
}

function Ensure-Pnpm {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        return
    }

    Write-Step 'Installing pnpm'
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
        corepack enable
        corepack prepare pnpm@latest --activate
        Refresh-Path
    }

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        npm install -g pnpm
        Refresh-Path
    }

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm could not be installed. Open a new PowerShell window and rerun this script."
    }
}

Write-Step 'Checking Windows prerequisites'
Ensure-Command -Command git -WingetId Git.Git -DisplayName Git
Ensure-Command -Command node -WingetId OpenJS.NodeJS.LTS -DisplayName 'Node.js LTS'
Ensure-Command -Command cloudflared -WingetId Cloudflare.cloudflared -DisplayName cloudflared
Ensure-Pnpm

if (Test-Path (Join-Path $RepoDir '.git')) {
    Write-Step "Updating RayAlgo repo at $RepoDir"
    git -C $RepoDir fetch origin $Branch
    git -C $RepoDir checkout $Branch
    git -C $RepoDir pull --ff-only origin $Branch
} else {
    Write-Step "Cloning RayAlgo repo to $RepoDir"
    git clone --branch $Branch --depth 1 $RepoUrl $RepoDir
}

Write-Step 'Installing project dependencies'
Push-Location $RepoDir
try {
    pnpm install --frozen-lockfile

    Write-Step 'Building IB Gateway bridge'
    pnpm --filter '@workspace/ibkr-bridge' build

    Write-Step 'Launching IB Gateway bridge'
    if ($Mode -eq 'paper') {
        & (Join-Path $RepoDir 'Run-IBGatewayBridge.cmd') paper
    } else {
        & (Join-Path $RepoDir 'Run-IBGatewayBridge.cmd')
    }
} finally {
    Pop-Location
}
