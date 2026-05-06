<#
.SYNOPSIS
  RayAlgo one-click IB Gateway bridge helper for Windows.

.DESCRIPTION
  Registers the rayalgo-ibkr:// protocol for the current Windows user and
  handles launch links from the RayAlgo UI. The helper starts or reuses
  IB Gateway, the local RayAlgo IBKR bridge, and a Cloudflare quick tunnel,
  then attaches the active tunnel URL to the RayAlgo API.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ProtocolUrl,
    [switch]$Install,
    [string]$ActivationUrl,
    [string]$LaunchUrl,
    [string]$RepoDir = (Join-Path $env:USERPROFILE 'rayalgo-trading-platform'),
    [string]$RepoUrl = 'https://github.com/logicalorigin/trading-platform.git',
    [string]$Branch = 'main',
    [int]$BridgePort = 3002
)

$ErrorActionPreference = 'Stop'
$StateDir = Join-Path $env:LOCALAPPDATA 'RayAlgo\ibkr-bridge'
$LogDir = Join-Path $StateDir 'logs'
$BridgePidFile = Join-Path $StateDir 'bridge.pid'
$CloudflaredPidFile = Join-Path $StateDir 'cloudflared.pid'
$TunnelUrlFile = Join-Path $StateDir 'tunnel-url.txt'
$BridgeTokenFile = Join-Path $StateDir 'bridge-token.txt'
$BuildRefFile = Join-Path $StateDir 'bridge-build-ref.txt'
$BridgeBundleHashFile = Join-Path $StateDir 'bridge-bundle.sha256'
$LockHashFile = Join-Path $StateDir 'pnpm-lock.sha256'
$RunLog = Join-Path $LogDir 'bridge-launch.log'
$HelperVersion = '2026-05-06.gateway-reuse-v13'
$script:BridgeBundleHash = ''

New-Item -ItemType Directory -Force -Path $StateDir, $LogDir | Out-Null

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date).ToString('s'), $Message
    Add-Content -Path $RunLog -Value $line
    Write-Host $Message
}

function Truncate-Message([string]$Text, [int]$MaxLength = 360) {
    if (-not $Text) {
        return ''
    }

    $singleLine = (($Text -replace '\s+', ' ').Trim())
    if ($singleLine.Length -le $MaxLength) {
        return $singleLine
    }

    return $singleLine.Substring(0, $MaxLength) + '...'
}

function Read-LogTail([string]$Path, [int]$LineCount = 80) {
    if (-not (Test-Path $Path)) {
        return ''
    }

    try {
        return ((Get-Content -Path $Path -Tail $LineCount -ErrorAction Stop) -join "`n").Trim()
    } catch {
        return "Unable to read ${Path}: $($_.Exception.Message)"
    }
}

function Get-BridgeAttemptDetail([string]$OutPath, [string]$ErrPath, $HealthResult) {
    $parts = @()
    if ($HealthResult -and $HealthResult.LastError) {
        $parts += "last health check: $($HealthResult.LastError)"
    }

    $errTail = Read-LogTail -Path $ErrPath -LineCount 60
    if ($errTail) {
        $parts += "stderr:`n$errTail"
    }

    $outTail = Read-LogTail -Path $OutPath -LineCount 60
    if ($outTail) {
        $parts += "stdout:`n$outTail"
    }

    if ($parts.Count -eq 0) {
        return 'No bridge stdout/stderr was captured.'
    }

    return ($parts -join "`n---`n")
}

function New-HexToken([int]$ByteCount) {
    $bytes = New-Object 'Byte[]' $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-OrCreate-BridgeToken {
    param([string]$PreferredToken = '')

    if ($PreferredToken -and $PreferredToken.Trim().Length -ge 24) {
        $token = $PreferredToken.Trim()
        Set-Content -Path $BridgeTokenFile -Value $token
        return $token
    }

    if (Test-Path $BridgeTokenFile) {
        $existing = (Get-Content $BridgeTokenFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($existing -and $existing.Trim().Length -ge 24) {
            return $existing.Trim()
        }
    }

    $token = New-HexToken -ByteCount 16
    Set-Content -Path $BridgeTokenFile -Value $token
    return $token
}

function Resolve-OwnScriptPath {
    if ($PSCommandPath) {
        return $PSCommandPath
    }
    return $MyInvocation.MyCommand.Path
}

function Install-ProtocolHandler {
    $installDir = Join-Path $env:LOCALAPPDATA 'RayAlgo\ibkr-bridge'
    $target = Join-Path $installDir 'rayalgo-ibkr-helper.ps1'
    $source = Resolve-OwnScriptPath

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    if ($source -and ((Resolve-Path $source).Path -ne $target)) {
        Copy-Item -Path $source -Destination $target -Force
    }

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $command = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$target`" `"%1`""
    $key = 'HKCU:\Software\Classes\rayalgo-ibkr'
    $commandKey = Join-Path $key 'shell\open\command'

    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value 'URL:RayAlgo IBKR Bridge'
    New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-Item -Path (Join-Path $key 'shell') -Force | Out-Null
    New-Item -Path (Join-Path $key 'shell\open') -Force | Out-Null
    New-Item -Path $commandKey -Force | Out-Null
    Set-Item -Path $commandKey -Value $command

    Write-Log "Installed rayalgo-ibkr:// protocol handler."
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

    Send-BridgeProgress -Status 'starting_bridge' -Step 'installing_prerequisite' -Message "Installing $DisplayName."
    Write-Log "Installing $DisplayName."
    winget install --id $WingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$DisplayName installed, but '$Command' is still not on PATH. Open a new PowerShell window and retry the bridge launch."
    }
}

function Ensure-Pnpm {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        return
    }

    Send-BridgeProgress -Status 'starting_bridge' -Step 'installing_pnpm' -Message 'Installing pnpm.'
    Write-Log 'Installing pnpm.'
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
        throw 'pnpm could not be installed. Open a new PowerShell window and retry the bridge launch.'
    }
}

function Read-FirstLine([string]$Path) {
    if (-not (Test-Path $Path)) {
        return $null
    }

    return (Get-Content $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path $Path)) {
        return $null
    }

    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RepoHead {
    try {
        return (git -C $RepoDir rev-parse HEAD).Trim()
    } catch {
        Write-Log "Could not read repo HEAD: $($_.Exception.Message)"
        return $null
    }
}

function Parse-LaunchUrl([string]$RawUrl) {
    $clean = $RawUrl.Trim().Trim('"')
    $uri = [Uri]$clean
    if ($uri.Scheme -ne 'rayalgo-ibkr') {
        throw "Unsupported bridge launch URL scheme '$($uri.Scheme)'."
    }

    $params = @{}
    foreach ($pair in $uri.Query.TrimStart('?').Split('&')) {
        if (-not $pair) {
            continue
        }
        $parts = $pair.Split('=', 2)
        $key = [Uri]::UnescapeDataString($parts[0])
        $value = ''
        if ($parts.Count -gt 1) {
            $value = [Uri]::UnescapeDataString($parts[1])
        }
        $params[$key] = $value
    }

    return $params
}

function Get-RequiredParam($Params, [string]$Name) {
    $value = $Params[$Name]
    if (-not $value) {
        throw "Bridge launch URL is missing '$Name'."
    }
    return [string]$value
}

function Test-TruthyParam($Value) {
    if (-not $Value) {
        return $false
    }

    $normalized = ([string]$Value).Trim().ToLowerInvariant()
    return @('1', 'true', 'yes', 'y') -contains $normalized
}

function Invoke-HelperSelfUpdateIfNeeded($Params, [string]$RawLaunchUrl) {
    $requestedVersion = [string]$Params['helperVersion']
    $helperUrl = [string]$Params['helperUrl']
    if (-not $requestedVersion -or -not $helperUrl -or $requestedVersion -eq $HelperVersion) {
        return
    }

    if ($env:RAYALGO_IBKR_HELPER_SELF_UPDATE -eq $requestedVersion) {
        Write-Log "Helper self-update already attempted for $requestedVersion; continuing with local version $HelperVersion."
        return
    }

    $target = Join-Path $StateDir 'rayalgo-ibkr-helper.ps1'
    $download = Join-Path $StateDir 'rayalgo-ibkr-helper.new.ps1'
    Send-BridgeProgress -Status 'starting_bridge' -Step 'updating_helper' -Message "Updating RayAlgo IBKR helper from $HelperVersion to $requestedVersion."
    Invoke-WebRequest -UseBasicParsing -Uri $helperUrl -OutFile $download
    if (-not (Test-Path $download) -or (Get-Item $download).Length -lt 4096) {
        throw 'Downloaded helper was empty or incomplete.'
    }
    Move-Item -Path $download -Destination $target -Force
    $env:RAYALGO_IBKR_HELPER_SELF_UPDATE = $requestedVersion

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $target -Install
    Start-Process -FilePath $powershell `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $target, $RawLaunchUrl) `
        | Out-Null
    Write-Log "Relaunched updated RayAlgo IBKR helper $requestedVersion."
    exit 0
}

function Invoke-BridgeAttach([hashtable]$Body) {
    $uri = "$script:ApiBaseUrl/api/ibkr/bridge/attach"
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $json -TimeoutSec 30
}

function Send-BridgeProgress(
    [string]$Status,
    [string]$Step,
    [string]$Message,
    [string]$BridgeUrl = $null
) {
    $suffix = ''
    if ($BridgeUrl) {
        $suffix = " ($BridgeUrl)"
    }
    Write-Log "$Step`: $Message$suffix"

    if (-not $script:ApiBaseUrl -or -not $script:ActivationId -or -not $script:CallbackSecret) {
        return
    }

    try {
        $body = @{
            callbackSecret = $script:CallbackSecret
            status = $Status
            step = $Step
            message = $Message
            helperVersion = $HelperVersion
        }
        if ($BridgeUrl) {
            $body.bridgeUrl = $BridgeUrl
        }
        $json = $body | ConvertTo-Json -Depth 8 -Compress
        Invoke-RestMethod `
            -Method Post `
            -Uri "$script:ApiBaseUrl/api/ibkr/activation/$script:ActivationId/progress" `
            -ContentType 'application/json' `
            -Body $json `
            -TimeoutSec 5 `
            | Out-Null
    } catch {
        Write-Log "Activation progress callback skipped: $($_.Exception.Message)"
    }
}

function Complete-BridgeAttach([string]$BridgeUrl) {
    $body = @{
        bridgeUrl = $BridgeUrl
        bridgeToken = $script:BridgeToken
        managementToken = $script:ManagementToken
        bridgeId = $script:ActivationId
        activationId = $script:ActivationId
        helperVersion = $HelperVersion
    }
    Invoke-BridgeAttach -Body $body | Out-Null
}

function Test-TcpPort([string]$HostName, [int]$Port) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(1000, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        if ($client) {
            $client.Close()
        }
    }
}

function Get-IBGatewayProcessSummary {
    try {
        $seen = @{}
        $summaries = New-Object System.Collections.Generic.List[string]

        $processes = @(Get-Process -Name ibgateway -ErrorAction SilentlyContinue)
        foreach ($process in $processes) {
            $pidText = [string]$process.Id
            if (-not $seen.ContainsKey($pidText)) {
                $seen[$pidText] = $true
                $summaries.Add(("pid={0} name={1}" -f $process.Id, $process.ProcessName))
            }
        }

        $candidateFilter = "Name = 'ibgateway.exe' OR Name = 'java.exe' OR Name = 'javaw.exe'"
        $cimProcesses = @()
        try {
            $cimProcesses = @(Get-CimInstance Win32_Process -Filter $candidateFilter -ErrorAction Stop)
        } catch {
            if (Get-Command Get-WmiObject -ErrorAction SilentlyContinue) {
                try {
                    $cimProcesses = @(Get-WmiObject Win32_Process -Filter $candidateFilter -ErrorAction Stop)
                } catch {
                    Write-Log "IB Gateway process command-line detection skipped: $($_.Exception.Message)"
                }
            } else {
                Write-Log "IB Gateway process command-line detection skipped: $($_.Exception.Message)"
            }
        }

        foreach ($process in $cimProcesses) {
            $processName = [string]$process.Name
            $commandLine = [string]$process.CommandLine
            $executablePath = [string]$process.ExecutablePath
            $haystack = "$processName $commandLine $executablePath"
            $looksLikeGateway = (
                $processName -ieq 'ibgateway.exe' -or
                $haystack -match '(?i)(\\|/)Jts(\\|/)ibgateway(\\|/)' -or
                $haystack -match '(?i)(\\|/)ibgateway(\\|/)' -or
                $haystack -match '(?i)\bibgateway(\.exe)?\b'
            )

            if (-not $looksLikeGateway) {
                continue
            }

            $pidText = [string]$process.ProcessId
            if (-not $seen.ContainsKey($pidText)) {
                $seen[$pidText] = $true
                if (-not $processName) {
                    $processName = 'process'
                }
                $summaries.Add(("pid={0} name={1}" -f $process.ProcessId, $processName))
            }
        }

        if ($summaries.Count -eq 0) {
            return $null
        }

        return ($summaries.ToArray() -join ', ')
    } catch {
        return $null
    }
}

function Find-IBGatewayExecutable {
    if ($env:IB_GATEWAY_EXE -and (Test-Path $env:IB_GATEWAY_EXE)) {
        return $env:IB_GATEWAY_EXE
    }

    $knownCandidates = @(
        'C:\Jts\ibgateway\ibgateway.exe',
        'C:\Jts\ibgateway\latest\ibgateway.exe'
    )

    foreach ($candidate in $knownCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    if (Test-Path 'C:\Jts') {
        $match = Get-ChildItem -Path 'C:\Jts' -Recurse -Filter ibgateway.exe -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($match) {
            return $match.FullName
        }
    }

    if ($env:RAYALGO_SCAN_FOR_IB_GATEWAY -ne '1') {
        return $null
    }

    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Programs'),
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)}
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($root in $roots) {
        $match = Get-ChildItem -Path $root -Recurse -Filter ibgateway.exe -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($match) {
            return $match.FullName
        }
    }

    return $null
}

function Ensure-IBGatewaySocket {
    if (Test-TcpPort -HostName '127.0.0.1' -Port 4001) {
        Send-BridgeProgress -Status 'launched' -Step 'gateway_ready' -Message 'IB Gateway live API socket is reachable on 127.0.0.1:4001.'
        return
    }

    if (Test-TcpPort -HostName '127.0.0.1' -Port 4002) {
        throw 'IB Gateway paper API socket is reachable on 127.0.0.1:4002, but RayAlgo live bridge launch requires the live API socket on 127.0.0.1:4001. Switch Gateway to live mode or enable live API port 4001, then retry the bridge launch.'
    }

    $runningGateway = Get-IBGatewayProcessSummary
    if ($runningGateway) {
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_running_waiting_socket' -Message "IB Gateway is already running ($runningGateway). Waiting for live API socket 4001; log in and enable API socket port 4001 if prompted."
        $existingDeadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $existingDeadline) {
            if (Test-TcpPort -HostName '127.0.0.1' -Port 4001) {
                Send-BridgeProgress -Status 'launched' -Step 'gateway_ready' -Message 'IB Gateway live API socket is reachable on 127.0.0.1:4001.'
                return
            }
            if (Test-TcpPort -HostName '127.0.0.1' -Port 4002) {
                throw 'IB Gateway paper API socket opened on 127.0.0.1:4002, but live bridge launch requires 127.0.0.1:4001.'
            }
            Start-Sleep -Seconds 2
        }

        throw 'IB Gateway is already running, but the live API socket did not open on 127.0.0.1:4001. Log in to live mode, enable API socket port 4001, then retry the bridge launch.'
    }

    Send-BridgeProgress -Status 'waiting_gateway' -Step 'launching_gateway' -Message 'Launching IB Gateway. Log in if prompted.'
    $gateway = Find-IBGatewayExecutable
    if ($gateway) {
        Write-Log "Launching IB Gateway from $gateway."
        Start-Process -FilePath $gateway | Out-Null
    } else {
        Write-Log 'IB Gateway executable was not found automatically.'
    }

    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort -HostName '127.0.0.1' -Port 4001) {
            Send-BridgeProgress -Status 'launched' -Step 'gateway_ready' -Message 'IB Gateway live API socket is reachable on 127.0.0.1:4001.'
            return
        }
        if (Test-TcpPort -HostName '127.0.0.1' -Port 4002) {
            throw 'IB Gateway paper API socket opened on 127.0.0.1:4002, but live bridge launch requires 127.0.0.1:4001.'
        }
        Start-Sleep -Seconds 2
    }

    throw 'IB Gateway live API socket did not open on 127.0.0.1:4001. Open IB Gateway, log in to live mode, enable API socket port 4001, then retry the bridge launch.'
}

function Ensure-RepoAndBridgeBuild {
    $fallbackRepoDir = $RepoDir

    if ($script:BridgeBundleUrl) {
        try {
            Ensure-Command -Command node -WingetId OpenJS.NodeJS.LTS -DisplayName 'Node.js LTS'
            Ensure-Command -Command cloudflared -WingetId Cloudflare.cloudflared -DisplayName cloudflared
            if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
                throw 'Windows tar.exe was not found. Install Windows 10/11 built-in tar support or use Git Bash tar, then retry the bridge launch.'
            }

            $bundleDir = Join-Path $StateDir 'bridge-runtime'
            $archive = Join-Path $StateDir 'bridge-bundle.tar.gz'
            $distEntry = Join-Path $bundleDir 'artifacts\ibkr-bridge\dist\index.mjs'
            Send-BridgeProgress -Status 'starting_bridge' -Step 'downloading_bridge_bundle' -Message 'Downloading the RayAlgo IB Gateway bridge bundle.'
            Invoke-WebRequest -UseBasicParsing -Uri $script:BridgeBundleUrl -OutFile $archive
            $currentBundleHash = Get-FileSha256 -Path $archive
            $lastBundleHash = Read-FirstLine -Path $BridgeBundleHashFile
            $bundleChanged = (-not $currentBundleHash) -or ($currentBundleHash -ne $lastBundleHash) -or (-not (Test-Path $distEntry))
            $script:BridgeBundleChanged = $bundleChanged
            $script:BridgeBundleHash = [string]$currentBundleHash
            $script:RepoDir = $bundleDir

            if ($bundleChanged) {
                Remove-Item -Path $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
                New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
                tar -xzf $archive -C $bundleDir
                if ($currentBundleHash) {
                    Set-Content -Path $BridgeBundleHashFile -Value $currentBundleHash
                }
            } else {
                Write-Log 'Downloaded bridge bundle matches the installed bundle.'
            }

            if (-not (Test-Path $distEntry)) {
                throw 'The downloaded IB Gateway bridge bundle is missing artifacts\ibkr-bridge\dist\index.mjs.'
            }

            Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_bundle_ready' -Message 'IB Gateway bridge bundle is ready.'
            return
        } catch {
            $bundleError = $_.Exception.Message
            Write-Log "Bridge bundle path failed; falling back to repo build. $bundleError"
            Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_bundle_fallback' -Message (Truncate-Message "Bridge bundle was unavailable, so the helper is falling back to the RayAlgo repo build. $bundleError")
            $script:BridgeBundleUrl = ''
            $script:BridgeBundleChanged = $false
            $script:BridgeBundleHash = ''
            $script:RepoDir = $fallbackRepoDir
        }
    }

    Ensure-Command -Command git -WingetId Git.Git -DisplayName Git
    Ensure-Command -Command node -WingetId OpenJS.NodeJS.LTS -DisplayName 'Node.js LTS'
    Ensure-Command -Command cloudflared -WingetId Cloudflare.cloudflared -DisplayName cloudflared
    Ensure-Pnpm

    $distEntry = Join-Path $RepoDir 'artifacts\ibkr-bridge\dist\index.mjs'
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Send-BridgeProgress -Status 'starting_bridge' -Step 'updating_repo' -Message 'Checking the local RayAlgo bridge repo.'
        try {
            git -C $RepoDir fetch origin $Branch --depth 1
            git -C $RepoDir checkout -B $Branch FETCH_HEAD
        } catch {
            if (Test-Path $distEntry) {
                Write-Log "Repo update skipped; using the existing bridge build. $($_.Exception.Message)"
            } else {
                throw "Repo update failed and no bridge build exists yet. $($_.Exception.Message)"
            }
        }
    } else {
        Send-BridgeProgress -Status 'starting_bridge' -Step 'cloning_repo' -Message 'Cloning the RayAlgo bridge repo.'
        git clone --branch $Branch --depth 1 $RepoUrl $RepoDir
    }

    Push-Location $RepoDir
    try {
        $lockFile = Join-Path $RepoDir 'pnpm-lock.yaml'
        $currentLockHash = Get-FileSha256 -Path $lockFile
        $lastLockHash = Read-FirstLine -Path $LockHashFile
        $needsInstall = -not (Test-Path (Join-Path $RepoDir 'node_modules\.modules.yaml'))
        if ($currentLockHash -and $currentLockHash -ne $lastLockHash) {
            $needsInstall = $true
        }

        if ($needsInstall) {
            Send-BridgeProgress -Status 'starting_bridge' -Step 'installing_dependencies' -Message 'Installing bridge dependencies.'
            pnpm install --frozen-lockfile
            if ($currentLockHash) {
                Set-Content -Path $LockHashFile -Value $currentLockHash
            }
        }

        $currentHead = Get-RepoHead
        $lastBuildRef = Read-FirstLine -Path $BuildRefFile
        $needsBuild = -not (Test-Path $distEntry)
        if ($currentHead -and $currentHead -ne $lastBuildRef) {
            $needsBuild = $true
        }

        if ($needsBuild) {
            Send-BridgeProgress -Status 'starting_bridge' -Step 'building_bridge' -Message 'Building the IB Gateway bridge.'
            pnpm --filter '@workspace/ibkr-bridge' build
            if ($currentHead) {
                Set-Content -Path $BuildRefFile -Value $currentHead
            }
        }

        if (-not (Test-Path $distEntry)) {
            throw 'The IB Gateway bridge build output is missing after build.'
        }
    } finally {
        Pop-Location
    }
}

function Get-BridgeHeaders {
    return @{ Authorization = "Bearer $script:BridgeToken" }
}

function Get-BridgeHealthResult([string]$BaseUrl) {
    try {
        $health = Invoke-RestMethod -Uri "$BaseUrl/healthz" -Headers (Get-BridgeHeaders) -TimeoutSec 15
        $target = [string]$health.connectionTarget
        $mode = [string]$health.sessionMode
        $marketDataMode = [string]$health.marketDataMode
        $accountsLoaded = ($health.accountsLoaded -eq $true)
        if (-not $accountsLoaded -and $health.accounts) {
            $accountsLoaded = (@($health.accounts).Count -gt 0)
        }
        $liveMode = (
            $health.configuredLiveMarketDataMode -eq $true -or
            $marketDataMode.ToLowerInvariant() -eq 'live' -or
            $health.liveMarketDataAvailable -eq $true
        )
        $expectedConfig = (
            $target -eq '127.0.0.1:4001' -and
            $mode.ToLowerInvariant() -eq 'live' -and
            $liveMode
        )
        $healthy = (
            $health.connected -eq $true -and
            $health.authenticated -eq $true -and
            $health.competing -ne $true -and
            $accountsLoaded -and
            $expectedConfig
        )
        if ($healthy) {
            Invoke-RestMethod -Uri "$BaseUrl/accounts" -Headers (Get-BridgeHeaders) -TimeoutSec 15 | Out-Null
        }
        return @{
            Healthy = $healthy
            Competing = ($health.competing -eq $true)
            LastError = [string]$health.lastError
            StrictReady = ($health.strictReady -eq $true)
            StrictReason = [string]$health.strictReason
            BridgeRuntimeBuild = [string]$health.bridgeRuntimeBuild
            Target = $target
            Mode = $mode
            MarketDataMode = $marketDataMode
            AccountsLoaded = $accountsLoaded
        }
    } catch {
        Write-Log "Bridge check failed for $BaseUrl`: $($_.Exception.Message)"
        return @{
            Healthy = $false
            Competing = $false
            LastError = $_.Exception.Message
            StrictReady = $false
            StrictReason = 'health_error'
            BridgeRuntimeBuild = ''
            Target = ''
            Mode = ''
            MarketDataMode = ''
            AccountsLoaded = $false
        }
    }
}

function Test-BridgeReady([string]$BaseUrl) {
    try {
        Invoke-RestMethod -Uri "$BaseUrl/readyz" -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 401 -or $statusCode -eq 404) {
            return $true
        }
        return $false
    }
}

function Test-BridgeUrl([string]$BaseUrl) {
    $result = Get-BridgeHealthResult -BaseUrl $BaseUrl
    return ($result.Healthy -eq $true)
}

function Stop-ProcessFromPidFile([string]$PidFile) {
    if (-not (Test-Path $PidFile)) {
        return
    }

    $pidValue = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pidValue -match '^\d+$') {
        $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
        if ($process) {
            Write-Log "Stopping stale bridge process $($process.Id) from PID file."
            Stop-Process -Id $process.Id -Force
        }
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Stop-BridgePortProcess {
    try {
        if (-not (Test-TcpPort -HostName '127.0.0.1' -Port $BridgePort)) {
            Write-Log "Bridge port $BridgePort is free; stale port cleanup skipped."
            return
        }

        Write-Log "Bridge port $BridgePort is listening; checking for a stale local bridge owner."
        $netstat = & "$env:SystemRoot\System32\netstat.exe" -ano -p tcp 2>$null
        $owners = New-Object System.Collections.Generic.HashSet[int]
        foreach ($line in $netstat) {
            if ($line -notmatch "LISTENING\s+(\d+)\s*$") {
                continue
            }
            $ownerPid = [int]$Matches[1]

            if ($line -notmatch "(\s|^)(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):$BridgePort\s+") {
                continue
            }

            [void]$owners.Add($ownerPid)
        }

        foreach ($owner in $owners) {
            $process = Get-Process -Id $owner -ErrorAction SilentlyContinue
            if (-not $process) {
                continue
            }

            if ($process.ProcessName -match '^(node|nodejs)$') {
                Write-Log "Stopping stale local bridge process $owner on port $BridgePort."
                Stop-Process -Id $owner -Force
            } else {
                Write-Log "Port $BridgePort is owned by $($process.ProcessName) pid $owner; leaving it running."
            }
        }
    } catch {
        Write-Log "Bridge port cleanup skipped: $($_.Exception.Message)"
    }
}

function Ensure-LocalBridge {
    $localBaseUrl = "http://127.0.0.1:$BridgePort"
    $localHealth = Get-BridgeHealthResult -BaseUrl $localBaseUrl
    if ($localHealth.Healthy -eq $true) {
        $expectedBuild = [string]$script:BridgeBundleHash
        $runningBuild = [string]$localHealth.BridgeRuntimeBuild
        $buildMismatch = (
            $script:BridgeBundleUrl -and
            $expectedBuild -and
            $runningBuild -ne $expectedBuild
        )
        if ($script:BridgeBundleChanged -eq $true) {
            Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_restart_for_bundle' -Message 'Restarting the local IB Gateway bridge to use the updated bridge bundle.'
        } elseif ($buildMismatch) {
            Write-Log "Local bridge build '$runningBuild' does not match downloaded bundle '$expectedBuild'; restarting."
            Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_restart_for_bundle' -Message 'Restarting the local IB Gateway bridge to use the downloaded bridge bundle.'
        } else {
            Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_reused' -Message 'Reusing the local IB Gateway bridge.'
            return $localBaseUrl
        }
    }

    $out = Join-Path $LogDir 'bridge.out.log'
    $err = Join-Path $LogDir 'bridge.err.log'
    $entry = Join-Path $RepoDir 'artifacts\ibkr-bridge\dist\index.mjs'

    foreach ($clientId in 101..105) {
        Send-BridgeProgress -Status 'starting_bridge' -Step 'preparing_bridge' -Message "Preparing the local IB Gateway bridge with client ID $clientId."
        Stop-ProcessFromPidFile -PidFile $BridgePidFile
        Stop-BridgePortProcess
        Send-BridgeProgress -Status 'starting_bridge' -Step 'starting_bridge' -Message "Starting the local IB Gateway bridge with client ID $clientId."
        Remove-Item $out, $err -ErrorAction SilentlyContinue

        $env:PORT = [string]$BridgePort
        $env:LOG_LEVEL = 'info'
        $env:IBKR_TRANSPORT = 'tws'
        $env:IBKR_TWS_HOST = '127.0.0.1'
        $env:IBKR_TWS_PORT = '4001'
        $env:IBKR_TWS_CLIENT_ID = [string]$clientId
        $env:IBKR_TWS_MODE = 'live'
        $env:IBKR_TWS_MARKET_DATA_TYPE = '1'
        $env:IBKR_BRIDGE_API_TOKEN = $script:BridgeToken
        $env:IBKR_BRIDGE_PREWARM_SYMBOLS = ''
        $env:IBKR_BRIDGE_RUNTIME_BUILD = [string]$script:BridgeBundleHash

        $process = Start-Process node `
            -WorkingDirectory $RepoDir `
            -ArgumentList @('--enable-source-maps', $entry) `
            -RedirectStandardOutput $out `
            -RedirectStandardError $err `
            -PassThru
        Set-Content -Path $BridgePidFile -Value $process.Id

        $deadline = (Get-Date).AddSeconds(50)
        $lastHealthResult = $null
        while ((Get-Date) -lt $deadline) {
            if (-not (Test-BridgeReady -BaseUrl $localBaseUrl)) {
                if ($process.HasExited) {
                    $detail = Get-BridgeAttemptDetail -OutPath $out -ErrPath $err -HealthResult $lastHealthResult
                    Write-Log "Local bridge exited before opening HTTP for client ID $clientId. $detail"
                    break
                }
                Start-Sleep -Seconds 2
                continue
            }

            $result = Get-BridgeHealthResult -BaseUrl $localBaseUrl
            $lastHealthResult = $result
            if ($result.Healthy -eq $true) {
                if ($result.StrictReady -eq $true) {
                    Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_ready' -Message "Local IB Gateway bridge is connected and streaming with client ID $clientId."
                } else {
                    Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_ready' -Message "Local IB Gateway bridge is connected with client ID $clientId; waiting for fresh stream proof in the app."
                }
                return $localBaseUrl
            }
            if ($result.Competing -eq $true) {
                Write-Log "Client ID $clientId is competing with another TWS API client. Retrying."
                break
            }
            if ($process.HasExited) {
                $errorText = ''
                if (Test-Path $err) {
                    $errorText = Get-Content $err -Raw
                }
                Write-Log "Local bridge exited for client ID $clientId. $errorText"
                break
            }
            Start-Sleep -Seconds 2
        }

        $detail = Get-BridgeAttemptDetail -OutPath $out -ErrPath $err -HealthResult $lastHealthResult
        Write-Log "Local bridge did not become healthy for client ID $clientId. $detail"
        Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_unhealthy' -Message (Truncate-Message "Local bridge did not become healthy for client ID $clientId. $detail")
        Stop-ProcessFromPidFile -PidFile $BridgePidFile
        Stop-BridgePortProcess
    }

    throw 'Local IB Gateway bridge did not become healthy with client IDs 101 through 105.'
}

function Ensure-CloudflareTunnel([string]$LocalBaseUrl) {
    if ($script:ForceFreshTunnel) {
        Write-Log 'Fresh tunnel requested; clearing cached Cloudflare quick tunnel state.'
        Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
        Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile
    } elseif (Test-Path $TunnelUrlFile) {
        $storedUrl = (Get-Content $TunnelUrlFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($storedUrl -and (Test-BridgeUrl -BaseUrl $storedUrl)) {
            Send-BridgeProgress -Status 'starting_tunnel' -Step 'tunnel_reused' -Message 'Reusing the existing Cloudflare quick tunnel.' -BridgeUrl $storedUrl
            return $storedUrl
        }
        Write-Log 'Cached Cloudflare quick tunnel is stale; clearing it before launching a new tunnel.'
        Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
        Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile
    }

    Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile
    Send-BridgeProgress -Status 'starting_tunnel' -Step 'starting_tunnel' -Message 'Starting a Cloudflare quick tunnel.'

    $out = Join-Path $LogDir 'cloudflared.out.log'
    $err = Join-Path $LogDir 'cloudflared.err.log'
    Remove-Item $out, $err -ErrorAction SilentlyContinue

    $process = Start-Process cloudflared `
        -ArgumentList @('tunnel', '--url', $LocalBaseUrl) `
        -RedirectStandardOutput $out `
        -RedirectStandardError $err `
        -PassThru
    Set-Content -Path $CloudflaredPidFile -Value $process.Id

    $publicUrl = $null
    $deadline = (Get-Date).AddSeconds(75)
    while ((Get-Date) -lt $deadline -and -not $publicUrl) {
        Start-Sleep -Seconds 1
        $text = ''
        if (Test-Path $out) {
            $text += Get-Content $out -Raw
        }
        if (Test-Path $err) {
            $text += Get-Content $err -Raw
        }
        if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $publicUrl = $Matches[0]
        }
        if ($process.HasExited -and -not $publicUrl) {
            throw "cloudflared exited before publishing a tunnel URL. $text"
        }
    }

    if (-not $publicUrl) {
        throw 'Cloudflare quick tunnel did not publish a URL in time.'
    }

    Set-Content -Path $TunnelUrlFile -Value $publicUrl
    Send-BridgeProgress -Status 'validating' -Step 'validating_tunnel' -Message 'Validating the public Cloudflare tunnel.' -BridgeUrl $publicUrl

    $validateDeadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $validateDeadline) {
        if (Test-BridgeUrl -BaseUrl $publicUrl) {
            return $publicUrl
        }
        Start-Sleep -Seconds 2
    }

    Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
    Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile
    throw 'Cloudflare quick tunnel is published but the bridge health check is not passing yet.'
}

try {
    if ($Install) {
        Install-ProtocolHandler
    }

    $rawLaunchUrl = $LaunchUrl
    if (-not $rawLaunchUrl) {
        $rawLaunchUrl = $ActivationUrl
    }
    if (-not $rawLaunchUrl) {
        $rawLaunchUrl = $ProtocolUrl
    }

    if (-not $rawLaunchUrl) {
        Write-Log 'Protocol handler is installed. Start the IB Gateway bridge from the RayAlgo header.'
        exit 0
    }

    $params = Parse-LaunchUrl -RawUrl $rawLaunchUrl
    $script:ActivationId = [string]$params['activationId']
    $script:CallbackSecret = [string]$params['callbackSecret']
    $script:ApiBaseUrl = (Get-RequiredParam -Params $params -Name 'apiBaseUrl').TrimEnd('/')
    Invoke-HelperSelfUpdateIfNeeded -Params $params -RawLaunchUrl $rawLaunchUrl
    $script:BridgeToken = Get-OrCreate-BridgeToken -PreferredToken (Get-RequiredParam -Params $params -Name 'bridgeToken')
    $script:ManagementToken = [string]$params['managementToken']
    $script:ForceFreshTunnel = Test-TruthyParam $params['forceFreshTunnel']

    if ($params['repoUrl']) {
        $RepoUrl = [string]$params['repoUrl']
    }
    if ($params['branch']) {
        $Branch = [string]$params['branch']
    }
    if ($params['bundleUrl']) {
        $script:BridgeBundleUrl = [string]$params['bundleUrl']
        $script:RepoDir = Join-Path $StateDir 'bridge-runtime'
    }

    Send-BridgeProgress -Status 'launched' -Step 'helper_launched' -Message 'Windows bridge helper launched.'
    Ensure-IBGatewaySocket
    Ensure-RepoAndBridgeBuild
    $localBaseUrl = Ensure-LocalBridge
    $publicUrl = Ensure-CloudflareTunnel -LocalBaseUrl $localBaseUrl
    Complete-BridgeAttach -BridgeUrl $publicUrl
    Send-BridgeProgress -Status 'connected' -Step 'connected' -Message 'IB Gateway bridge attached.' -BridgeUrl $publicUrl
    Write-Log "IB Gateway bridge attached with $publicUrl."
} catch {
    $message = $_.Exception.Message
    Write-Log "IB Gateway bridge launch failed: $message"
    Send-BridgeProgress -Status 'error' -Step 'error' -Message $message
    throw
}
