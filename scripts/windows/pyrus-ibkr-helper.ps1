<#
.SYNOPSIS
  Pyrus one-click IB Gateway bridge helper for Windows.

.DESCRIPTION
  Registers the pyrus-ibkr:// protocol for the current Windows user. The helper
  starts or reuses IB Gateway, the local Pyrus IBKR bridge, and a Cloudflare
  quick tunnel, then attaches the active tunnel URL to the Pyrus API.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ProtocolUrl,
    [switch]$Install,
    [switch]$InstallAgent,
    [switch]$Agent,
    [string]$ActivationUrl,
    [string]$LaunchUrl,
    [string]$ApiBaseUrl,
    [int]$AgentPollSeconds = 5,
    [string]$RepoDir = (Join-Path $env:USERPROFILE 'pyrus-trading-platform'),
    [string]$RepoUrl = 'https://github.com/logicalorigin/trading-platform.git',
    [string]$Branch = 'main',
    [int]$BridgePort = 3002
)

$ErrorActionPreference = 'Stop'
$StateDir = Join-Path $env:LOCALAPPDATA 'Pyrus\ibkr-bridge'
$PreviousStateDir = Join-Path $env:LOCALAPPDATA ('Ray' + 'Algo\ibkr-bridge')
$LogDir = Join-Path $StateDir 'logs'
$BridgePidFile = Join-Path $StateDir 'bridge.pid'
$CloudflaredPidFile = Join-Path $StateDir 'cloudflared.pid'
$TunnelUrlFile = Join-Path $StateDir 'tunnel-url.txt'
$BridgeTokenFile = Join-Path $StateDir 'bridge-token.txt'
$BuildRefFile = Join-Path $StateDir 'bridge-build-ref.txt'
$BridgeBundleHashFile = Join-Path $StateDir 'bridge-bundle.sha256'
$LockHashFile = Join-Path $StateDir 'pnpm-lock.sha256'
$DesktopAgentTaskName = 'Pyrus IBKR Desktop Agent'
$DesktopIdFile = Join-Path $StateDir 'desktop-id.txt'
$DesktopSecretFile = Join-Path $StateDir 'desktop-secret.txt'
$DesktopAgentConfigFile = Join-Path $StateDir 'desktop-agent.json'
$DesktopAgentPidFile = Join-Path $StateDir 'desktop-agent.pid'
$DesktopAgentStartupFileName = 'Pyrus IBKR Desktop Agent.cmd'
$AutoLoginDir = Join-Path $StateDir 'auto-login'
$AutoLoginSettingsFile = Join-Path $AutoLoginDir 'auto-login.json'
$AutoLoginCredentialFile = Join-Path $AutoLoginDir 'credential.json'
$AutoLoginRuntimeRoot = Join-Path $StateDir 'ibc-runtime'
$RunLog = Join-Path $LogDir 'bridge-launch.log'
$HelperVersion = '2026-05-24.remote-desktop-agent-v23'
$LoginHandoffAlgorithm = 'RSA-OAEP-256-CHUNKED'
$script:BridgeBundleHash = ''
$script:SensitiveValues = New-Object System.Collections.Generic.List[string]

New-Item -ItemType Directory -Force -Path $StateDir, $LogDir | Out-Null

function Copy-ExistingStatePath([string]$RelativePath) {
    if (-not (Test-Path $PreviousStateDir)) {
        return
    }

    $source = Join-Path $PreviousStateDir $RelativePath
    $destination = Join-Path $StateDir $RelativePath
    if (-not (Test-Path $source) -or (Test-Path $destination)) {
        return
    }

    $parent = Split-Path -Parent $destination
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -Path $source -Destination $destination -Force
}

foreach ($relativePath in @(
    'bridge-token.txt',
    'bridge-build-ref.txt',
    'bridge-bundle.sha256',
    'desktop-id.txt',
    'desktop-secret.txt',
    'desktop-agent.json',
    'auto-login\auto-login.json',
    'auto-login\credential.json'
)) {
    Copy-ExistingStatePath -RelativePath $relativePath
}

function Register-SensitiveValue([string]$Value) {
    if (-not $Value) {
        return
    }

    $trimmed = $Value.Trim()
    if ($trimmed.Length -lt 3) {
        return
    }

    if (-not $script:SensitiveValues.Contains($trimmed)) {
        $script:SensitiveValues.Add($trimmed) | Out-Null
    }
}

function Redact-Message([string]$Message) {
    if (-not $Message) {
        return ''
    }

    $safe = [string]$Message
    foreach ($value in ($script:SensitiveValues | Sort-Object Length -Descending)) {
        if ($value) {
            $safe = $safe -replace [regex]::Escape($value), '[redacted]'
        }
    }

    $safe = $safe -replace '(?i)(IbPassword|TWSPASSWORD|password)\s*=\s*[^;\s]+', '$1=[redacted]'
    $safe = $safe -replace '(?i)(IbLoginId|TWSUSERID|username)\s*=\s*[^;\s]+', '$1=[redacted]'
    return $safe
}

function Write-Log([string]$Message) {
    $safeMessage = Redact-Message $Message
    $line = '{0} {1}' -f (Get-Date).ToString('s'), $safeMessage
    Add-Content -Path $RunLog -Value $line
    Write-Host $safeMessage
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
        $parts += "last health check: $(Redact-Message $HealthResult.LastError)"
    }

    $errTail = Read-LogTail -Path $ErrPath -LineCount 60
    if ($errTail) {
        $parts += "stderr:`n$(Redact-Message $errTail)"
    }

    $outTail = Read-LogTail -Path $OutPath -LineCount 60
    if ($outTail) {
        $parts += "stdout:`n$(Redact-Message $outTail)"
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

    if (Test-Path $BridgeTokenFile) {
        $existing = (Get-Content $BridgeTokenFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($existing -and $existing.Trim().Length -ge 24) {
            return $existing.Trim()
        }
    }

    if ($PreferredToken -and $PreferredToken.Trim().Length -ge 24) {
        $token = $PreferredToken.Trim()
        Set-Content -Path $BridgeTokenFile -Value $token
        return $token
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
    $installDir = $StateDir
    $target = Join-Path $installDir 'pyrus-ibkr-helper.ps1'
    $source = Resolve-OwnScriptPath

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    if ($source -and ((Resolve-Path $source).Path -ne $target)) {
        Copy-Item -Path $source -Destination $target -Force
    }

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $command = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$target`" `"%1`""
    $key = 'HKCU:\Software\Classes\pyrus-ibkr'
    $commandKey = Join-Path $key 'shell\open\command'

    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value 'URL:Pyrus IBKR Bridge'
    New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-Item -Path (Join-Path $key 'shell') -Force | Out-Null
    New-Item -Path (Join-Path $key 'shell\open') -Force | Out-Null
    New-Item -Path $commandKey -Force | Out-Null
    Set-Item -Path $commandKey -Value $command

    Write-Log "Installed pyrus-ibkr:// protocol handler."
}

function Read-DesktopAgentConfig {
    if (-not (Test-Path $DesktopAgentConfigFile)) {
        return $null
    }

    try {
        return Get-Content -Path $DesktopAgentConfigFile -Raw -ErrorAction Stop | ConvertFrom-Json
    } catch {
        Write-Log "Could not read desktop agent config: $($_.Exception.Message)"
        return $null
    }
}

function Save-DesktopAgentConfig([string]$BaseUrl) {
    if (-not $BaseUrl) {
        return
    }

    $normalized = $BaseUrl.Trim().TrimEnd('/')
    if (-not $normalized) {
        return
    }

    $config = @{
        apiBaseUrl = $normalized
        helperVersion = $HelperVersion
        updatedAt = (Get-Date).ToString('o')
    }
    $config | ConvertTo-Json -Depth 4 | Set-Content -Path $DesktopAgentConfigFile
}

function Resolve-DesktopAgentApiBaseUrl([string]$PreferredBaseUrl = '') {
    if ($PreferredBaseUrl -and $PreferredBaseUrl.Trim()) {
        return $PreferredBaseUrl.Trim().TrimEnd('/')
    }

    $config = Read-DesktopAgentConfig
    if ($config -and $config.apiBaseUrl) {
        return ([string]$config.apiBaseUrl).Trim().TrimEnd('/')
    }

    throw 'Desktop agent API URL is not configured. Run the IBKR launcher once from this Windows computer, then retry mobile launch.'
}

function Get-OrCreate-DesktopAgentIdentity {
    $desktopId = Read-FirstLine -Path $DesktopIdFile
    $desktopSecret = Read-FirstLine -Path $DesktopSecretFile

    if (-not $desktopId -or $desktopId.Trim().Length -lt 12) {
        $desktopId = "desktop-$($env:COMPUTERNAME)-$(New-HexToken -ByteCount 8)"
        Set-Content -Path $DesktopIdFile -Value $desktopId
    } else {
        $desktopId = $desktopId.Trim()
    }

    if (-not $desktopSecret -or $desktopSecret.Trim().Length -lt 24) {
        $desktopSecret = New-HexToken -ByteCount 32
        Set-Content -Path $DesktopSecretFile -Value $desktopSecret
    } else {
        $desktopSecret = $desktopSecret.Trim()
    }

    return @{
        desktopId = $desktopId
        desktopSecret = $desktopSecret
    }
}

function Get-DesktopAgentLabel {
    if ($env:COMPUTERNAME -and $env:USERNAME) {
        return "$($env:COMPUTERNAME)\$($env:USERNAME)"
    }
    if ($env:COMPUTERNAME) {
        return $env:COMPUTERNAME
    }
    return 'Windows desktop'
}

function Invoke-DesktopAgentPost([string]$BaseUrl, [string]$Path, [hashtable]$Body, [int]$TimeoutSec = 15) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod `
        -Method Post `
        -Uri "$BaseUrl$Path" `
        -ContentType 'application/json' `
        -Body $json `
        -TimeoutSec $TimeoutSec
}

function Register-DesktopAgent([string]$BaseUrl, [string]$ActivationId = '', [string]$CallbackSecret = '') {
    $identity = Get-OrCreate-DesktopAgentIdentity
    $body = @{
        desktopId = $identity['desktopId']
        desktopSecret = $identity['desktopSecret']
        helperVersion = $HelperVersion
        label = Get-DesktopAgentLabel
    }
    if ($ActivationId -and $CallbackSecret) {
        $body.activationId = $ActivationId
        $body.callbackSecret = $CallbackSecret
    }

    $result = Invoke-DesktopAgentPost -BaseUrl $BaseUrl -Path '/api/ibkr/desktop/register' -Body $body
    Write-Log "Desktop agent registered for remote IBKR launches."
    return $result
}

function Send-DesktopAgentHeartbeat([string]$BaseUrl) {
    $identity = Get-OrCreate-DesktopAgentIdentity
    $body = @{
        desktopId = $identity['desktopId']
        desktopSecret = $identity['desktopSecret']
        helperVersion = $HelperVersion
        label = Get-DesktopAgentLabel
    }
    return Invoke-DesktopAgentPost -BaseUrl $BaseUrl -Path '/api/ibkr/desktop/heartbeat' -Body $body -TimeoutSec 10
}

function Claim-DesktopAgentLaunchJob([string]$BaseUrl) {
    $identity = Get-OrCreate-DesktopAgentIdentity
    $body = @{
        desktopId = $identity['desktopId']
        desktopSecret = $identity['desktopSecret']
        helperVersion = $HelperVersion
        label = Get-DesktopAgentLabel
    }
    return Invoke-DesktopAgentPost -BaseUrl $BaseUrl -Path '/api/ibkr/desktop/jobs/claim' -Body $body -TimeoutSec 10
}

function Complete-DesktopAgentJob([string]$BaseUrl, [string]$JobId, [string]$CompletionToken, [bool]$Ok, [string]$Message) {
    if (-not $BaseUrl -or -not $JobId -or -not $CompletionToken) {
        return
    }

    try {
        $body = @{
            jobId = $JobId
            completionToken = $CompletionToken
            ok = $Ok
            message = $Message
        }
        Invoke-DesktopAgentPost -BaseUrl $BaseUrl -Path '/api/ibkr/desktop/jobs/complete' -Body $body -TimeoutSec 10 | Out-Null
    } catch {
        Write-Log "Desktop agent job completion callback failed: $($_.Exception.Message)"
    }
}

function Start-BridgeLaunchProcess([string]$LaunchUrl) {
    $target = Resolve-OwnScriptPath
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Start-Process -FilePath $powershell `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $target, '-LaunchUrl', $LaunchUrl) `
        | Out-Null
}

function Test-DesktopAgentProcessRunning {
    $pidValue = Read-FirstLine -Path $DesktopAgentPidFile
    if (-not $pidValue -or $pidValue -notmatch '^\d+$') {
        return $false
    }

    $pidNumber = [int]$pidValue
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidNumber" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -match '(pyrus|pyrus)-ibkr-helper\.ps1' -and $process.CommandLine -match '\s-Agent(\s|$)') {
            return $true
        }
    } catch {
        $process = Get-Process -Id $pidNumber -ErrorAction SilentlyContinue
        if ($process -and @('powershell', 'pwsh') -contains ([string]$process.ProcessName).ToLowerInvariant()) {
            return $true
        }
    }

    Remove-Item $DesktopAgentPidFile -ErrorAction SilentlyContinue
    return $false
}

function Start-DesktopAgentProcess([string]$BaseUrl) {
    if (Test-DesktopAgentProcessRunning) {
        Write-Log 'Pyrus IBKR desktop agent is already running.'
        return
    }

    $target = Join-Path $StateDir 'pyrus-ibkr-helper.ps1'
    if (-not (Test-Path $target)) {
        $target = Resolve-OwnScriptPath
    }
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $process = Start-Process -FilePath $powershell `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $target, '-Agent', '-ApiBaseUrl', $BaseUrl) `
        -WindowStyle Hidden `
        -PassThru
    Set-Content -Path $DesktopAgentPidFile -Value $process.Id
    Write-Log "Started Pyrus IBKR desktop agent process $($process.Id)."
}

function Install-DesktopAgentStartupFallback([string]$BaseUrl) {
    $startupDir = [Environment]::GetFolderPath('Startup')
    if (-not $startupDir) {
        $startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    }
    New-Item -ItemType Directory -Force -Path $startupDir | Out-Null

    $target = Join-Path $StateDir 'pyrus-ibkr-helper.ps1'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $startupFile = Join-Path $startupDir $DesktopAgentStartupFileName
    $lines = @(
        '@echo off',
        'setlocal',
        "set ""PYRUS_IBKR_API_BASE_URL=$BaseUrl""",
        "set ""PYRUS_IBKR_HELPER=$target""",
        "start """" /min ""$powershell"" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%PYRUS_IBKR_HELPER%"" -Agent -ApiBaseUrl ""%PYRUS_IBKR_API_BASE_URL%"""
    )
    Set-Content -Path $startupFile -Value $lines -Encoding ASCII
    Write-Log "Installed Pyrus IBKR desktop agent Startup fallback at $startupFile."
}

function Install-DesktopAgent([string]$BaseUrl) {
    $resolvedBaseUrl = Resolve-DesktopAgentApiBaseUrl -PreferredBaseUrl $BaseUrl
    Save-DesktopAgentConfig -BaseUrl $resolvedBaseUrl
    Install-ProtocolHandler

    try {
        $target = Join-Path $StateDir 'pyrus-ibkr-helper.ps1'
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$target`" -Agent -ApiBaseUrl `"$resolvedBaseUrl`""
        $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
        Register-ScheduledTask `
            -TaskName $DesktopAgentTaskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Description 'Keeps Pyrus IBKR launch requests on this Windows desktop.' `
            -Force `
            | Out-Null
        Start-ScheduledTask -TaskName $DesktopAgentTaskName -ErrorAction Stop
        Write-Log "Installed Pyrus IBKR desktop agent scheduled task."
    } catch {
        Write-Log "Desktop agent scheduled task install failed: $($_.Exception.Message). Using current-user Startup fallback."
        Install-DesktopAgentStartupFallback -BaseUrl $resolvedBaseUrl
        Start-DesktopAgentProcess -BaseUrl $resolvedBaseUrl
    }
}

function Start-DesktopAgent([string]$PreferredBaseUrl = '') {
    $baseUrl = Resolve-DesktopAgentApiBaseUrl -PreferredBaseUrl $PreferredBaseUrl
    Save-DesktopAgentConfig -BaseUrl $baseUrl
    Set-Content -Path $DesktopAgentPidFile -Value $PID -ErrorAction SilentlyContinue
    Write-Log "Pyrus IBKR desktop agent polling $baseUrl."

    while ($true) {
        try {
            Register-DesktopAgent -BaseUrl $baseUrl | Out-Null
            Send-DesktopAgentHeartbeat -BaseUrl $baseUrl | Out-Null
            $job = Claim-DesktopAgentLaunchJob -BaseUrl $baseUrl
            if ($job -and $job.ready -eq $true) {
                $jobAction = [string]$job.action
                if (-not $jobAction -and $job.launchUrl) {
                    $jobAction = 'launch'
                }

                if ($jobAction -eq 'shutdown') {
                    Write-Log "Desktop agent claimed IBKR shutdown job $($job.jobId)."
                    try {
                        Stop-IBKRDesktopBridgeAndGateway
                        Complete-DesktopAgentJob -BaseUrl $baseUrl -JobId ([string]$job.jobId) -CompletionToken ([string]$job.completionToken) -Ok $true -Message 'IBKR bridge, tunnel, and Gateway shutdown completed.'
                    } catch {
                        Complete-DesktopAgentJob -BaseUrl $baseUrl -JobId ([string]$job.jobId) -CompletionToken ([string]$job.completionToken) -Ok $false -Message $_.Exception.Message
                        throw
                    }
                } elseif ($jobAction -eq 'launch' -and $job.launchUrl) {
                    Write-Log "Desktop agent claimed IBKR launch job $($job.jobId)."
                    Start-BridgeLaunchProcess -LaunchUrl ([string]$job.launchUrl)
                } else {
                    Write-Log "Desktop agent ignored unsupported IBKR job $($job.jobId) action '$jobAction'."
                }
            }
        } catch {
            Write-Log "Desktop agent polling failed: $($_.Exception.Message)"
        }

        $sleepSeconds = [Math]::Max(2, [Math]::Min(30, $AgentPollSeconds))
        Start-Sleep -Seconds $sleepSeconds
    }
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
    if ($uri.Scheme -ne 'pyrus-ibkr') {
        throw "Unsupported bridge launch URL scheme '$($uri.Scheme)'."
    }

    $params = @{}
    if ($uri.Host) {
        $params['action'] = $uri.Host
    }
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

    if ($env:PYRUS_IBKR_HELPER_SELF_UPDATE -eq $requestedVersion) {
        Write-Log "Helper self-update already attempted for $requestedVersion; continuing with local version $HelperVersion."
        return
    }

    $target = Join-Path $StateDir 'pyrus-ibkr-helper.ps1'
    $download = Join-Path $StateDir 'pyrus-ibkr-helper.new.ps1'
    Send-BridgeProgress -Status 'starting_bridge' -Step 'updating_helper' -Message "Updating Pyrus IBKR helper from $HelperVersion to $requestedVersion."
    Invoke-WebRequest -UseBasicParsing -Uri $helperUrl -OutFile $download
    if (-not (Test-Path $download) -or (Get-Item $download).Length -lt 4096) {
        throw 'Downloaded helper was empty or incomplete.'
    }
    Copy-Item -Path $download -Destination $target -Force
    $currentTarget = Resolve-OwnScriptPath
    if ($currentTarget -and (Test-Path $currentTarget) -and ((Resolve-Path $currentTarget).Path -ne (Resolve-Path $target).Path)) {
        try {
            Copy-Item -Path $download -Destination $currentTarget -Force
        } catch {
            Write-Log "Updated installed helper, but could not refresh the running script path: $($_.Exception.Message)"
        }
    }
    Remove-Item -Path $download -Force -ErrorAction SilentlyContinue
    $env:PYRUS_IBKR_HELPER_SELF_UPDATE = $requestedVersion

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $target -Install
    Start-Process -FilePath $powershell `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $target, $RawLaunchUrl) `
        | Out-Null
    Write-Log "Relaunched updated Pyrus IBKR helper $requestedVersion."
    exit 0
}

function Invoke-BridgeAttach([hashtable]$Body) {
    if ($script:ActivationId) {
        $uri = "$script:ApiBaseUrl/api/ibkr/activation/$script:ActivationId/complete"
    } else {
        $uri = "$script:ApiBaseUrl/api/ibkr/bridge/attach"
    }
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $json -TimeoutSec 30
}

function Send-BridgeProgress(
    [string]$Status,
    [string]$Step,
    [string]$Message,
    [string]$BridgeUrl = $null
) {
    $safeMessage = Redact-Message $Message
    $suffix = ''
    if ($BridgeUrl) {
        $suffix = " ($BridgeUrl)"
    }
    Write-Log "$Step`: $safeMessage$suffix"

    if (-not $script:ApiBaseUrl -or -not $script:ActivationId -or -not $script:CallbackSecret) {
        return
    }

    try {
        $body = @{
            callbackSecret = $script:CallbackSecret
            status = $Status
            step = $Step
            message = $safeMessage
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

function Test-ActivationCanceled {
    if (-not $script:ApiBaseUrl -or -not $script:ActivationId -or -not $script:CallbackSecret) {
        return $false
    }

    try {
        $body = @{
            callbackSecret = $script:CallbackSecret
        }
        $json = $body | ConvertTo-Json -Depth 4 -Compress
        $result = Invoke-RestMethod `
            -Method Post `
            -Uri "$script:ApiBaseUrl/api/ibkr/activation/$script:ActivationId/status" `
            -ContentType 'application/json' `
            -Body $json `
            -TimeoutSec 5
        return ($result -and $result.canceled -eq $true)
    } catch {
        $message = [string]$_.Exception.Message
        if ($message -match 'superseded|not found|canceled') {
            return $true
        }
        return $false
    }
}

function Assert-ActivationNotCanceled {
    if (Test-ActivationCanceled) {
        throw 'IB Gateway bridge launch was canceled from Pyrus.'
    }
}

function Complete-BridgeAttach([string]$BridgeUrl) {
    $body = @{
        callbackSecret = $script:CallbackSecret
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
            $cimProcesses = @(Get-CimInstance Win32_Process -Filter $candidateFilter -OperationTimeoutSec 3 -ErrorAction Stop)
        } catch {
            Write-Log "IB Gateway process command-line detection skipped: $($_.Exception.Message)"
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

function Get-IBGatewayProcessIds {
    $ids = New-Object System.Collections.Generic.HashSet[int]

    try {
        $processes = @(Get-Process -Name ibgateway -ErrorAction SilentlyContinue)
        foreach ($process in $processes) {
            [void]$ids.Add([int]$process.Id)
        }
    } catch {
        Write-Log "IB Gateway process scan skipped: $($_.Exception.Message)"
    }

    try {
        $candidateFilter = "Name = 'ibgateway.exe' OR Name = 'java.exe' OR Name = 'javaw.exe'"
        $cimProcesses = @(Get-CimInstance Win32_Process -Filter $candidateFilter -OperationTimeoutSec 3 -ErrorAction Stop)
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

            if ($looksLikeGateway) {
                [void]$ids.Add([int]$process.ProcessId)
            }
        }
    } catch {
        Write-Log "IB Gateway command-line process scan skipped: $($_.Exception.Message)"
    }

    return @($ids | Where-Object { $_ -and $_ -ne $PID })
}

function Stop-IBGatewayProcesses {
    $processIds = @(Get-IBGatewayProcessIds)
    if ($processIds.Count -eq 0) {
        Write-Log 'No IB Gateway process was found to stop.'
        return
    }

    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }

        Write-Log "Stopping IB Gateway process $processId ($($process.ProcessName))."
        try {
            if ($process.MainWindowHandle -and $process.MainWindowHandle -ne 0) {
                [void]$process.CloseMainWindow()
                if ($process.WaitForExit(5000)) {
                    continue
                }
            }
        } catch {
            Write-Log "IB Gateway graceful close skipped for process ${processId}: $($_.Exception.Message)"
        }

        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
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

    if ($env:PYRUS_SCAN_FOR_IB_GATEWAY -ne '1') {
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

function Start-IBGatewayExecutable([string]$GatewayPath) {
    if (-not $GatewayPath -or -not (Test-Path $GatewayPath)) {
        throw 'IB Gateway executable was not found.'
    }

    $workingDirectory = Split-Path -Path $GatewayPath -Parent
    Start-Process -FilePath $GatewayPath -WorkingDirectory $workingDirectory -WindowStyle Normal | Out-Null
}

function Protect-PathForCurrentUser([string]$Path) {
    return
}

function Ensure-AutoLoginDirectory {
    New-Item -ItemType Directory -Force -Path $AutoLoginDir | Out-Null
    Protect-PathForCurrentUser -Path $AutoLoginDir
}

function Find-IBCStartGatewayScript {
    if ($env:PYRUS_IBC_START_GATEWAY -and (Test-Path $env:PYRUS_IBC_START_GATEWAY)) {
        return $env:PYRUS_IBC_START_GATEWAY
    }

    $settings = Read-AutoLoginSettings
    if ($settings -and $settings.ibcStartGatewayPath -and (Test-Path ([string]$settings.ibcStartGatewayPath))) {
        return [string]$settings.ibcStartGatewayPath
    }

    $knownCandidates = @(
        'C:\IBC\StartGateway.bat',
        (Join-Path $env:USERPROFILE 'IBC\StartGateway.bat'),
        (Join-Path $env:USERPROFILE 'Documents\IBC\StartGateway.bat'),
        (Join-Path $env:USERPROFILE 'Downloads\IBC\StartGateway.bat'),
        (Join-Path $env:USERPROFILE 'Desktop\IBC\StartGateway.bat')
    )

    foreach ($candidate in $knownCandidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    return $null
}

function Get-MaskedUsername([string]$Username) {
    if (-not $Username) {
        return ''
    }

    $trimmed = $Username.Trim()
    if ($trimmed.Length -le 2) {
        return ('*' * $trimmed.Length)
    }

    return ('{0}{1}{2}' -f $trimmed.Substring(0, 1), ('*' * [Math]::Min(6, $trimmed.Length - 2)), $trimmed.Substring($trimmed.Length - 1, 1))
}

function Convert-SecureStringToPlainText([System.Security.SecureString]$SecureString) {
    if (-not $SecureString) {
        return ''
    }

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

function ConvertTo-ProtectedString([string]$Value) {
    $secure = ConvertTo-SecureString -String $Value -AsPlainText -Force
    return ConvertFrom-SecureString -SecureString $secure
}

function ConvertFrom-ProtectedString([string]$ProtectedValue) {
    if (-not $ProtectedValue) {
        return ''
    }

    $secure = ConvertTo-SecureString -String $ProtectedValue
    return Convert-SecureStringToPlainText -SecureString $secure
}

function Read-AutoLoginSettings {
    if (-not (Test-Path $AutoLoginSettingsFile)) {
        return $null
    }

    try {
        return Get-Content -Path $AutoLoginSettingsFile -Raw -ErrorAction Stop | ConvertFrom-Json
    } catch {
        Write-Log "Could not read IB Gateway auto-login settings: $($_.Exception.Message)"
        return $null
    }
}

function Read-AutoLoginCredential {
    if (-not (Test-Path $AutoLoginCredentialFile)) {
        return $null
    }

    try {
        $record = Get-Content -Path $AutoLoginCredentialFile -Raw -ErrorAction Stop | ConvertFrom-Json
        $username = ConvertFrom-ProtectedString -ProtectedValue ([string]$record.usernameProtected)
        $password = ConvertFrom-ProtectedString -ProtectedValue ([string]$record.passwordProtected)
        if (-not $username -or -not $password) {
            return $null
        }
        Register-SensitiveValue -Value $username
        Register-SensitiveValue -Value $password
        return @{
            username = $username
            password = $password
        }
    } catch {
        Write-Log "Could not read IB Gateway auto-login credential: $($_.Exception.Message)"
        return $null
    }
}

function Save-AutoLoginCredential([string]$Username, [System.Security.SecureString]$Password) {
    $plainPassword = Convert-SecureStringToPlainText -SecureString $Password
    if (-not $Username -or -not $plainPassword) {
        throw 'IBKR username and password are required to configure auto-login.'
    }

    Register-SensitiveValue -Value $Username
    Register-SensitiveValue -Value $plainPassword

    $record = @{
        version = 1
        usernameProtected = ConvertTo-ProtectedString -Value $Username
        passwordProtected = ConvertTo-ProtectedString -Value $plainPassword
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $record | ConvertTo-Json -Depth 4 | Set-Content -Path $AutoLoginCredentialFile -Encoding UTF8
    Protect-PathForCurrentUser -Path $AutoLoginCredentialFile
}

function Configure-IBGatewayAutoLogin {
    Ensure-AutoLoginDirectory

    Write-Host ''
    Write-Host 'Pyrus IB Gateway auto-login setup'
    Write-Host 'Credentials stay on this Windows user profile using DPAPI. Pyrus does not send them to the API or browser.'
    Write-Host ''

    $detectedIbc = Find-IBCStartGatewayScript
    if ($detectedIbc) {
        $ibcPrompt = "Path to IBC StartGateway.bat [$detectedIbc]"
        $ibcStart = Read-Host $ibcPrompt
        if (-not $ibcStart) {
            $ibcStart = $detectedIbc
        }
    } else {
        $ibcStart = Read-Host 'Path to IBC StartGateway.bat'
    }

    $ibcStart = ([string]$ibcStart).Trim().Trim('"')
    if (-not $ibcStart -or -not (Test-Path $ibcStart)) {
        throw 'IBC StartGateway.bat was not found. Install IBC, then run Configure auto-login again.'
    }

    $gateway = Find-IBGatewayExecutable
    $username = Read-Host 'IBKR live username'
    $password = Read-Host 'IBKR live password' -AsSecureString
    Save-AutoLoginCredential -Username $username -Password $password

    $settings = @{
        version = 1
        enabled = $true
        mode = 'ib-gateway-live'
        tradingMode = 'live'
        apiPort = 4001
        ibcStartGatewayPath = $ibcStart
        gatewayPath = $gateway
        usernameMasked = Get-MaskedUsername -Username $username
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $settings | ConvertTo-Json -Depth 4 | Set-Content -Path $AutoLoginSettingsFile -Encoding UTF8
    Protect-PathForCurrentUser -Path $AutoLoginSettingsFile

    Write-Log "IB Gateway auto-login configured for $(Get-MaskedUsername -Username $username) using IBC StartGateway.bat at $ibcStart."
    Write-Host ''
    Write-Host 'Auto-login is configured. Launch with auto-login from Pyrus, then approve the IBKR Mobile/2FA prompt.'
}

function ConvertTo-JavaPropertyValue([string]$Value) {
    if ($null -eq $Value) {
        return ''
    }
    if ($Value -match "[`r`n]") {
        throw 'IBC config values cannot contain newline characters.'
    }

    $builder = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $Value.Length; $i++) {
        $char = [char]$Value[$i]
        $code = [int]$char

        if ($char -eq '\') {
            [void]$builder.Append('\\')
            continue
        }
        if ($char -eq ' ') {
            [void]$builder.Append('\ ')
            continue
        }
        if ($char -eq ':' -or $char -eq '=' -or $char -eq '#' -or $char -eq '!') {
            [void]$builder.Append('\')
            [void]$builder.Append($char)
            continue
        }
        if ($code -lt 32 -or $code -gt 126) {
            [void]$builder.Append(('\u{0:x4}' -f $code))
            continue
        }

        [void]$builder.Append($char)
    }

    return $builder.ToString()
}

function ConvertTo-Base64Url([byte[]]$Bytes) {
    return ([Convert]::ToBase64String($Bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function ConvertFrom-Base64Text([string]$Value) {
    $normalized = ([string]$Value).Trim().Replace('-', '+').Replace('_', '/')
    switch ($normalized.Length % 4) {
        2 { $normalized += '==' }
        3 { $normalized += '=' }
        1 { throw 'Invalid base64 payload.' }
    }

    return [Convert]::FromBase64String($normalized)
}

function New-LoginHandoffKey {
    $rsa = $null
    try {
        try {
            $rsa = New-Object System.Security.Cryptography.RSACng 4096
        } catch {
            $rsa = [System.Security.Cryptography.RSA]::Create()
            $rsa.KeySize = 4096
        }

        $parameters = $rsa.ExportParameters($false)
        $modulus = ConvertTo-Base64Url -Bytes $parameters.Modulus
        $exponent = ConvertTo-Base64Url -Bytes $parameters.Exponent
        $helperInstanceId = New-HexToken -ByteCount 16
        $publicKeyJwk = @{
            kty = 'RSA'
            n = $modulus
            e = $exponent
            alg = 'RSA-OAEP-256'
            ext = $true
            'key_ops' = @('encrypt')
        }

        return @{
            helperInstanceId = $helperInstanceId
            rsa = $rsa
            publicKeyJwk = $publicKeyJwk
        }
    } catch {
        if ($rsa) {
            $rsa.Dispose()
        }
        throw
    }
}

function Publish-LoginHandoffKey($Handoff) {
    $body = @{
        callbackSecret = $script:CallbackSecret
        helperInstanceId = [string]$Handoff.helperInstanceId
        algorithm = $LoginHandoffAlgorithm
        publicKeyJwk = $Handoff.publicKeyJwk
    }
    $json = $body | ConvertTo-Json -Depth 12 -Compress
    Invoke-RestMethod `
        -Method Post `
        -Uri "$script:ApiBaseUrl/api/ibkr/activation/$script:ActivationId/login-key" `
        -ContentType 'application/json' `
        -Body $json `
        -TimeoutSec 10 `
        | Out-Null
}

function Claim-LoginHandoffEnvelope([string]$HelperInstanceId) {
    $deadline = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $deadline) {
        Assert-ActivationNotCanceled
        $body = @{
            callbackSecret = $script:CallbackSecret
            helperInstanceId = $HelperInstanceId
        }
        $json = $body | ConvertTo-Json -Depth 6 -Compress
        $result = Invoke-RestMethod `
            -Method Post `
            -Uri "$script:ApiBaseUrl/api/ibkr/activation/$script:ActivationId/login-envelope/claim" `
            -ContentType 'application/json' `
            -Body $json `
            -TimeoutSec 10

        if ($result -and $result.ready -eq $true) {
            return $result.envelope
        }
        if ($result -and $result.canceled -eq $true) {
            throw 'IB Gateway bridge launch was canceled from Pyrus.'
        }

        Start-Sleep -Milliseconds 250
    }

    throw 'Timed out waiting for encrypted IBKR credentials from Pyrus.'
}

function ConvertFrom-LoginHandoffEnvelope($Envelope, $Rsa) {
    if (-not $Envelope) {
        throw 'IBKR credential envelope was empty.'
    }
    if ([string]$Envelope.algorithm -ne $LoginHandoffAlgorithm) {
        throw "Unsupported IBKR credential envelope algorithm '$([string]$Envelope.algorithm)'."
    }

    $bytes = New-Object System.Collections.Generic.List[byte]
    $padding = [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256
    foreach ($chunk in @($Envelope.ciphertextChunks)) {
        $ciphertext = ConvertFrom-Base64Text -Value ([string]$chunk)
        $plaintext = $Rsa.Decrypt($ciphertext, $padding)
        foreach ($byte in $plaintext) {
            $bytes.Add($byte) | Out-Null
        }
    }

    $json = [System.Text.Encoding]::UTF8.GetString($bytes.ToArray())
    $credential = $json | ConvertFrom-Json
    $username = ([string]$credential.username).Trim()
    $password = [string]$credential.password
    if (-not $username -or -not $password) {
        throw 'IBKR username and password are required for auto-login.'
    }

    Register-SensitiveValue -Value $username
    Register-SensitiveValue -Value $password

    return @{
        username = $username
        password = $password
        ibcStartGatewayPath = ([string]$credential.ibcStartGatewayPath).Trim().Trim('"')
        tradingMode = 'live'
    }
}

function Receive-OneTimeAutoLoginCredential {
    if (-not $script:ActivationId -or -not $script:CallbackSecret -or -not $script:ApiBaseUrl) {
        throw 'IB Gateway auto-login requires an active Pyrus bridge activation.'
    }

    $handoff = New-LoginHandoffKey
    try {
        Publish-LoginHandoffKey -Handoff $handoff
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'waiting_secure_credentials' -Message 'Waiting for encrypted IBKR credentials from Pyrus.'
        $envelope = Claim-LoginHandoffEnvelope -HelperInstanceId ([string]$handoff.helperInstanceId)
        $script:AutoLoginCredentialClaimed = $true
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'credentials_delivered' -Message 'Encrypted IBKR credentials were delivered to the Windows helper.'
        return ConvertFrom-LoginHandoffEnvelope -Envelope $envelope -Rsa $handoff.rsa
    } finally {
        if ($handoff -and $handoff.rsa) {
            $handoff.rsa.Dispose()
        }
    }
}

function New-IBCRuntimeFiles($Settings, $Credential) {
    $runtimeDir = Join-Path $AutoLoginRuntimeRoot (New-HexToken -ByteCount 8)
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Protect-PathForCurrentUser -Path $runtimeDir

    $configPath = Join-Path $runtimeDir 'config.ini'
    $logPath = Join-Path $runtimeDir 'logs'
    New-Item -ItemType Directory -Force -Path $logPath | Out-Null
    Protect-PathForCurrentUser -Path $logPath

    $configLines = @(
        'FIX=no',
        ('IbLoginId={0}' -f (ConvertTo-JavaPropertyValue ([string]$Credential.username))),
        ('IbPassword={0}' -f (ConvertTo-JavaPropertyValue ([string]$Credential.password))),
        'TradingMode=live',
        'SecondFactorDevice=',
        'ReloginAfterSecondFactorAuthenticationTimeout=no',
        'SecondFactorAuthenticationTimeout=180',
        'ExitAfterSecondFactorAuthenticationTimeout=no',
        'AcceptNonBrokerageAccountWarning=no',
        'ReadOnlyLogin=no',
        'ReadOnlyApi=no',
        'AcceptIncomingConnectionAction=reject',
        'AllowBlindTrading=no',
        'CommandServerPort=0',
        'IncludeStackTraceForExceptions=no'
    )
    $configLines | Set-Content -Path $configPath -Encoding ASCII
    Protect-PathForCurrentUser -Path $configPath

    $sourceStart = [string]$Settings.ibcStartGatewayPath
    $ibcPath = Split-Path -Path $sourceStart -Parent
    $startScript = Join-Path $runtimeDir 'StartGateway.Pyrus.bat'
    $scriptText = Get-Content -Path $sourceStart -Raw -ErrorAction Stop
    $scriptText = $scriptText -replace '(?m)^set\s+CONFIG=.*$', ('set "CONFIG={0}"' -f $configPath)
    $scriptText = $scriptText -replace '(?m)^set\s+TRADING_MODE=.*$', 'set "TRADING_MODE=live"'
    $scriptText = $scriptText -replace '(?m)^set\s+TWOFA_TIMEOUT_ACTION=.*$', 'set "TWOFA_TIMEOUT_ACTION=exit"'
    $scriptText = $scriptText -replace '(?m)^set\s+IBC_PATH=.*$', ('set "IBC_PATH={0}"' -f $ibcPath)
    $scriptText = $scriptText -replace '(?m)^set\s+LOG_PATH=.*$', ('set "LOG_PATH={0}"' -f $logPath)
    $scriptText = $scriptText -replace '(?m)^set\s+TWSUSERID=.*$', 'set "TWSUSERID="'
    $scriptText = $scriptText -replace '(?m)^set\s+TWSPASSWORD=.*$', 'set "TWSPASSWORD="'
    $scriptText | Set-Content -Path $startScript -Encoding ASCII
    Protect-PathForCurrentUser -Path $startScript

    return @{
        runtimeDir = $runtimeDir
        configPath = $configPath
        startScript = $startScript
    }
}

function Clear-IBCRuntimeSecrets($RuntimeFiles) {
    if (-not $RuntimeFiles) {
        return
    }

    Remove-Item -Path $RuntimeFiles.configPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $RuntimeFiles.startScript -Force -ErrorAction SilentlyContinue
}

function Initialize-WindowApi {
    if ('PyrusWin32Window' -as [type]) {
        return
    }

    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PyrusWin32Window {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
}

function Get-ProcessCommandText([int]$ProcessId) {
    try {
        $process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -OperationTimeoutSec 2 -ErrorAction Stop
        return ("{0} {1} {2}" -f ([string]$process.Name), ([string]$process.CommandLine), ([string]$process.ExecutablePath))
    } catch {
        return ''
    }
}

function Get-VisibleTopLevelWindows {
    try {
        Initialize-WindowApi
        $windows = New-Object System.Collections.Generic.List[object]
        $callback = [PyrusWin32Window+EnumWindowsProc]{
            param([IntPtr]$handle, [IntPtr]$state)

            if (-not [PyrusWin32Window]::IsWindowVisible($handle)) {
                return $true
            }

            $titleBuilder = New-Object System.Text.StringBuilder 512
            [void][PyrusWin32Window]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
            [uint32]$processId = 0
            [void][PyrusWin32Window]::GetWindowThreadProcessId($handle, [ref]$processId)
            if ($processId -le 0) {
                return $true
            }

            $processName = ''
            $processPath = ''
            try {
                $process = Get-Process -Id ([int]$processId) -ErrorAction Stop
                $processName = [string]$process.ProcessName
                try {
                    $processPath = [string]$process.Path
                } catch {}
            } catch {}

            $windows.Add([pscustomobject]@{
                Handle = $handle
                ProcessId = [int]$processId
                ProcessName = $processName
                ProcessPath = $processPath
                CommandText = ''
                Title = $titleBuilder.ToString()
            }) | Out-Null
            return $true
        }

        [void][PyrusWin32Window]::EnumWindows($callback, [IntPtr]::Zero)
        return $windows.ToArray()
    } catch {
        Write-Log "Visible window enumeration skipped: $($_.Exception.Message)"
        return @()
    }
}

function Test-IBGatewayWindowCandidate($Window) {
    if (-not $Window) {
        return $false
    }

    $title = [string]$Window.Title
    foreach ($pattern in @('IB Gateway', 'IBKR', 'Interactive Brokers', 'Trader Workstation', 'Login', 'Log In', 'Gateway')) {
        if ($title -like "*$pattern*") {
            return $true
        }
    }

    $processName = [string]$Window.ProcessName
    $processPath = [string]$Window.ProcessPath
    if ($processName -ieq 'ibgateway') {
        return $true
    }
    if ($processPath -match '(?i)(\\|/)Jts(\\|/)ibgateway(\\|/)') {
        return $true
    }
    if ($processPath -match '(?i)(\\|/)ibgateway(\\|/)') {
        return $true
    }

    if ($processName -notin @('java', 'javaw')) {
        return $false
    }

    $commandText = [string]$Window.CommandText
    if (-not $commandText) {
        $commandText = Get-ProcessCommandText -ProcessId ([int]$Window.ProcessId)
        $Window.CommandText = $commandText
    }

    $haystack = "$processName $processPath $commandText"
    if ($haystack -match '(?i)(\\|/)Jts(\\|/)ibgateway(\\|/)') {
        return $true
    }
    if ($haystack -match '(?i)(\\|/)ibgateway(\\|/)') {
        return $true
    }
    if ($haystack -match '(?i)\bibgateway(\.exe)?\b') {
        return $true
    }

    return $false
}

function Get-IBGatewayWindowCandidateScore($Window) {
    if (-not $Window) {
        return -1000
    }

    $score = 0
    $title = [string]$Window.Title
    if ($title -match '(?i)\b(log\s*in|login|sign\s*in)\b') {
        $score += 30
    }
    if ($title -match '(?i)\bIB\s+Gateway\b') {
        $score += 40
    }
    if ($title -match '(?i)\b(Interactive\s+Brokers|Trader\s+Workstation|IBKR)\b') {
        $score += 20
    }
    if ($title -match '(?i)\b(update|settings|configuration|warning|message)\b') {
        $score -= 30
    }

    $processName = [string]$Window.ProcessName
    $processPath = [string]$Window.ProcessPath
    $commandText = [string]$Window.CommandText
    if (-not $commandText) {
        $commandText = Get-ProcessCommandText -ProcessId ([int]$Window.ProcessId)
        $Window.CommandText = $commandText
    }
    $haystack = "$processName $processPath $commandText"
    if ($processName -ieq 'ibgateway') {
        $score += 80
    }
    if ($haystack -match '(?i)(\\|/)Jts(\\|/)ibgateway(\\|/)') {
        $score += 70
    } elseif ($haystack -match '(?i)(\\|/)ibgateway(\\|/)') {
        $score += 60
    } elseif ($haystack -match '(?i)\bibgateway(\.exe)?\b') {
        $score += 50
    }

    return $score
}

function Get-IBGatewayWindowCandidate {
    $windows = @(Get-VisibleTopLevelWindows | Where-Object { Test-IBGatewayWindowCandidate $_ })
    if ($windows.Count -eq 0) {
        return $null
    }

    return $windows |
        Sort-Object `
            @{ Expression = { Get-IBGatewayWindowCandidateScore $_ }; Descending = $true },
            @{ Expression = { [string]$_.Title }; Descending = $true } |
        Select-Object -First 1
}

function Activate-IBGatewayWindowCandidate($Window) {
    if (-not $Window) {
        return $false
    }

    try {
        Initialize-WindowApi
        [void][PyrusWin32Window]::ShowWindowAsync($Window.Handle, 9)
        Start-Sleep -Milliseconds 150
        if ([PyrusWin32Window]::SetForegroundWindow($Window.Handle)) {
            Start-Sleep -Milliseconds 250
            return $true
        }
    } catch {
        Write-Log "Could not activate IB Gateway window handle $($Window.Handle): $($_.Exception.Message)"
    }

    return $false
}

function Initialize-KeyInputApi {
    if ('PyrusKeyInput' -as [type]) {
        return
    }

    Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class PyrusKeyInput {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
}

function Invoke-KeyDown([byte]$VirtualKey) {
    Initialize-KeyInputApi
    [PyrusKeyInput]::keybd_event($VirtualKey, 0, 0, [UIntPtr]::Zero)
}

function Invoke-KeyUp([byte]$VirtualKey) {
    Initialize-KeyInputApi
    [PyrusKeyInput]::keybd_event($VirtualKey, 0, 2, [UIntPtr]::Zero)
}

function Invoke-KeyTap([byte]$VirtualKey, [int]$AfterMilliseconds = 180) {
    Invoke-KeyDown -VirtualKey $VirtualKey
    Start-Sleep -Milliseconds 80
    Invoke-KeyUp -VirtualKey $VirtualKey
    Start-Sleep -Milliseconds $AfterMilliseconds
}

function Invoke-ControlKey([byte]$VirtualKey, [int]$AfterMilliseconds = 250) {
    Invoke-KeyDown -VirtualKey 0x11
    Start-Sleep -Milliseconds 80
    Invoke-KeyTap -VirtualKey $VirtualKey -AfterMilliseconds 80
    Start-Sleep -Milliseconds 80
    Invoke-KeyUp -VirtualKey 0x11
    Start-Sleep -Milliseconds $AfterMilliseconds
}

function Get-IBGatewayWindowProcess {
    try {
        $window = Get-IBGatewayWindowCandidate
        if ($window) {
            return Get-Process -Id ([int]$window.ProcessId) -ErrorAction SilentlyContinue
        }

        $patterns = @('IB Gateway', 'IBKR', 'Interactive Brokers', 'Trader Workstation', 'Login', 'Log In', 'Gateway')
        $matches = Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $title = [string]$_.MainWindowTitle
            $matched = $false
            if ($title) {
                foreach ($pattern in $patterns) {
                    if ($title -like "*$pattern*") {
                        $matched = $true
                        break
                    }
                }
            }
            $matched
        }

        return $matches | Select-Object -First 1
    } catch {
        return $null
    }
}

function Wait-IBGatewayWindow([int]$TimeoutSeconds = 90, [switch]$AllowForegroundFallback) {
    $shell = New-Object -ComObject WScript.Shell
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastProgressAt = [DateTime]::MinValue
    while ((Get-Date) -lt $deadline) {
        Assert-ActivationNotCanceled
        $window = Get-IBGatewayWindowCandidate
        if ($window) {
            Write-Log "Activating IB Gateway window handle=$($window.Handle) pid=$($window.ProcessId) process='$($window.ProcessName)' title='$($window.Title)'."
            if (Activate-IBGatewayWindowCandidate -Window $window) {
                return $shell
            }
        }

        $process = Get-IBGatewayWindowProcess
        if ($process) {
            try {
                Write-Log "Activating IB Gateway window pid=$($process.Id) title='$($process.MainWindowTitle)'."
                if ($shell.AppActivate([int]$process.Id)) {
                    Start-Sleep -Seconds 1
                    return $shell
                }
            } catch {
                Write-Log "Could not activate IB Gateway window by PID $($process.Id): $($_.Exception.Message)"
            }
        }

        foreach ($title in @('IB Gateway', 'IBKR', 'Interactive Brokers', 'Trader Workstation', 'Login', 'Log In')) {
            try {
                if ($shell.AppActivate($title)) {
                    Start-Sleep -Seconds 1
                    return $shell
                }
            } catch {}
        }

        if (((Get-Date) - $lastProgressAt).TotalSeconds -ge 10) {
            $lastProgressAt = Get-Date
            $runningGateway = Get-IBGatewayProcessSummary
            if ($runningGateway) {
                Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_login_window_waiting' -Message "Waiting for the IB Gateway login window to become active ($runningGateway)."
            } else {
                Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_login_window_waiting' -Message 'Waiting for the IB Gateway login window to become active.'
            }
        }
        Start-Sleep -Milliseconds 500
    }

    if ($AllowForegroundFallback) {
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_foreground_fallback' -Message 'Could not confirm the Gateway window title. Click the IB Gateway username field now; Pyrus will type credentials in 5 seconds.'
        Write-Host ''
        Write-Host 'Pyrus could not confirm the IB Gateway login window.'
        Write-Host 'Click the IB Gateway username field now. Pyrus will type credentials in 5 seconds.'
        for ($i = 0; $i -lt 10; $i++) {
            Assert-ActivationNotCanceled
            Start-Sleep -Milliseconds 500
        }
        return $shell
    }

    throw 'Timed out waiting for the IB Gateway login window.'
}

function Set-ClipboardTextForPaste([string]$Text) {
    Add-Type -AssemblyName System.Windows.Forms
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            [System.Windows.Forms.Clipboard]::Clear()
            Start-Sleep -Milliseconds 80
            [System.Windows.Forms.Clipboard]::SetText($Text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
            return $true
        } catch {
            if ($attempt -ge 3) {
                throw
            }
            Start-Sleep -Milliseconds (160 * $attempt)
        }
    }
    return $false
}

function Invoke-SendKeysPaste($Shell, [string]$Text) {
    try {
        if (Set-ClipboardTextForPaste -Text $Text) {
            Start-Sleep -Milliseconds 250
            Invoke-ControlKey -VirtualKey 0x56 -AfterMilliseconds 500
            return
        }
    } catch {
        Write-Log "Clipboard paste unavailable; falling back to SendKeys text entry: $($_.Exception.Message)"
    }

    $Shell.SendKeys((ConvertTo-SendKeysLiteral -Value $Text))
    Start-Sleep -Milliseconds 650
}

function ConvertTo-SendKeysLiteral([string]$Value) {
    if ($null -eq $Value) {
        return ''
    }

    $builder = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $Value.Length; $i++) {
        $char = [string]$Value[$i]
        if ($char -eq "`r" -or $char -eq "`n") {
            continue
        }
        if (@('+', '^', '%', '~', '(', ')', '{', '}', '[', ']') -contains $char) {
            [void]$builder.Append('{')
            [void]$builder.Append($char)
            [void]$builder.Append('}')
        } else {
            [void]$builder.Append($char)
        }
    }

    return $builder.ToString()
}

function Invoke-IBGatewayCredentialTyping($Credential) {
    Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_login_window_wait' -Message 'Preparing to type one-time credentials into IB Gateway.'
    Assert-ActivationNotCanceled

    $gatewayProcessSummary = Get-IBGatewayProcessSummary
    $gatewayWindow = Get-IBGatewayWindowCandidate
    $startedGateway = $false
    if (-not $gatewayProcessSummary -and -not $gatewayWindow) {
        $gatewayPath = Find-IBGatewayExecutable
        if (-not $gatewayPath -or -not (Test-Path $gatewayPath)) {
            throw 'IB Gateway was not running and ibgateway.exe was not found. Start IB Gateway manually or install it under C:\Jts, then retry.'
        }
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'starting_gateway' -Message 'Starting IB Gateway.'
        Start-IBGatewayExecutable -GatewayPath $gatewayPath
        $startedGateway = $true
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_process_started' -Message 'IB Gateway process start requested; waiting for the login window.'
        Start-Sleep -Seconds 3
        Assert-ActivationNotCanceled
    } elseif (-not $gatewayWindow) {
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_running_waiting_login' -Message "IB Gateway is running; waiting for the login window to accept credentials ($gatewayProcessSummary)."
    }

    $windowWaitSeconds = 20
    if ($startedGateway) {
        $windowWaitSeconds = 45
    }
    $shell = Wait-IBGatewayWindow -TimeoutSeconds $windowWaitSeconds -AllowForegroundFallback
    $activeGatewayWindow = Get-IBGatewayWindowCandidate
    if ($activeGatewayWindow) {
        [void](Activate-IBGatewayWindowCandidate -Window $activeGatewayWindow)
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_login_window_active' -Message "IB Gateway login window is active; typing one-time credentials."
        Start-Sleep -Milliseconds 700
    }
    $clipboardText = $null
    $hadClipboardText = $false
    try {
        Add-Type -AssemblyName System.Windows.Forms
        try {
            $clipboardText = [System.Windows.Forms.Clipboard]::GetText()
            $hadClipboardText = $true
        } catch {}

        Send-BridgeProgress -Status 'waiting_gateway' -Step 'typing_gateway_credentials' -Message 'Typing IBKR credentials into IB Gateway.'
        Start-Sleep -Milliseconds 1500
        Invoke-ControlKey -VirtualKey 0x41 -AfterMilliseconds 300
        Invoke-SendKeysPaste -Shell $shell -Text ([string]$Credential.username)
        Invoke-KeyTap -VirtualKey 0x09 -AfterMilliseconds 500
        Invoke-ControlKey -VirtualKey 0x41 -AfterMilliseconds 300
        Invoke-SendKeysPaste -Shell $shell -Text ([string]$Credential.password)
        Invoke-KeyTap -VirtualKey 0x0D -AfterMilliseconds 250
    } finally {
        try {
            if ($hadClipboardText) {
                [System.Windows.Forms.Clipboard]::SetText($clipboardText)
            } else {
                [System.Windows.Forms.Clipboard]::Clear()
            }
        } catch {}
    }

    Send-BridgeProgress -Status 'waiting_gateway' -Step 'waiting_2fa' -Message 'Waiting for IBKR Mobile/2FA approval and live API socket 4001.'
    $deadline = (Get-Date).AddSeconds(300)
    while ((Get-Date) -lt $deadline) {
        Assert-ActivationNotCanceled
        if (Test-TcpPort -HostName '127.0.0.1' -Port 4001) {
            Send-BridgeProgress -Status 'launched' -Step 'gateway_socket_ready' -Message 'IB Gateway live API socket is reachable on 127.0.0.1:4001.'
            return
        }
        if (Test-TcpPort -HostName '127.0.0.1' -Port 4002) {
            throw 'IB Gateway paper API socket opened on 127.0.0.1:4002, but live bridge launch requires 127.0.0.1:4001.'
        }
        Start-Sleep -Seconds 2
    }

    throw 'Timed out waiting for IB Gateway live API socket 4001 after typing credentials. Approve the IBKR Mobile/2FA prompt, confirm Gateway API settings, then retry.'
}

function Start-IBGatewayWithIbc($Credential, [string]$IbcStartGatewayPath) {
    if (-not $IbcStartGatewayPath -or -not (Test-Path $IbcStartGatewayPath)) {
        throw 'IBC StartGateway.bat was not found.'
    }

    $settings = @{
        version = 1
        enabled = $true
        mode = 'ib-gateway-live'
        tradingMode = 'live'
        apiPort = 4001
        ibcStartGatewayPath = $IbcStartGatewayPath
        gatewayPath = Find-IBGatewayExecutable
        usernameMasked = Get-MaskedUsername -Username ([string]$credential.username)
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }

    $runtimeFiles = $null
    $process = $null
    try {
        $runtimeFiles = New-IBCRuntimeFiles -Settings $settings -Credential $credential
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'starting_ibc' -Message 'Starting IBC for IB Gateway live mode.'
        $process = Start-Process -FilePath $runtimeFiles.startScript -ArgumentList @('/INLINE') -WorkingDirectory $runtimeFiles.runtimeDir -PassThru
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'credentials_submitted' -Message 'IBC started with one-time credentials from Pyrus.'
        Send-BridgeProgress -Status 'waiting_gateway' -Step 'waiting_2fa' -Message 'Waiting for IBKR Mobile/2FA approval and live API socket 4001.'

        $deadline = (Get-Date).AddSeconds(300)
        while ((Get-Date) -lt $deadline) {
            Assert-ActivationNotCanceled
            if (Test-TcpPort -HostName '127.0.0.1' -Port 4001) {
                Send-BridgeProgress -Status 'launched' -Step 'gateway_socket_ready' -Message 'IB Gateway live API socket is reachable on 127.0.0.1:4001.'
                return
            }
            if (Test-TcpPort -HostName '127.0.0.1' -Port 4002) {
                throw 'IB Gateway paper API socket opened on 127.0.0.1:4002, but live bridge launch requires 127.0.0.1:4001.'
            }
            if ($process -and $process.HasExited) {
                throw "IBC exited before IB Gateway live API socket 4001 opened. Exit code: $($process.ExitCode)."
            }
            Start-Sleep -Seconds 2
        }

        throw 'Timed out waiting for IB Gateway live API socket 4001 after starting IBC. Approve the IBKR Mobile/2FA prompt, confirm Gateway API settings, then retry.'
    } finally {
        Clear-IBCRuntimeSecrets -RuntimeFiles $runtimeFiles
    }
}

function Start-IBGatewayWithAutoLogin {
    Send-BridgeProgress -Status 'waiting_gateway' -Step 'autologin_preflight' -Message 'Preparing one-time IB Gateway auto-login handoff.'
    Ensure-AutoLoginDirectory

    $credential = Receive-OneTimeAutoLoginCredential
    Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_window_login' -Message 'Using IB Gateway window login for one-time credentials.'
    Invoke-IBGatewayCredentialTyping -Credential $credential
}

function Ensure-IBGatewaySocket {
    Send-BridgeProgress -Status 'waiting_gateway' -Step 'checking_gateway_socket' -Message 'Checking IB Gateway live API socket on 127.0.0.1:4001.'

    if (Test-TcpPort -HostName '127.0.0.1' -Port 4001) {
        Send-BridgeProgress -Status 'launched' -Step 'gateway_ready' -Message 'IB Gateway live API socket is reachable on 127.0.0.1:4001.'
        return
    }

    if (Test-TcpPort -HostName '127.0.0.1' -Port 4002) {
        throw 'IB Gateway paper API socket is reachable on 127.0.0.1:4002, but Pyrus live bridge launch requires the live API socket on 127.0.0.1:4001. Switch Gateway to live mode or enable live API port 4001, then retry the bridge launch.'
    }

    if ($script:UseAutoLogin) {
        Start-IBGatewayWithAutoLogin
        return
    }

    $runningGateway = Get-IBGatewayProcessSummary
    if ($runningGateway) {
        if (-not $script:UseAutoLogin) {
            Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_running_waiting_socket' -Message "IB Gateway is already running ($runningGateway). Waiting for live API socket 4001; log in and enable API socket port 4001 if prompted."
        }
        $existingDeadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $existingDeadline) {
            Assert-ActivationNotCanceled
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
        Start-IBGatewayExecutable -GatewayPath $gateway
    } else {
        Write-Log 'IB Gateway executable was not found automatically.'
    }

    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        Assert-ActivationNotCanceled
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
            Send-BridgeProgress -Status 'starting_bridge' -Step 'downloading_bridge_bundle' -Message 'Downloading the Pyrus IB Gateway bridge bundle.'
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
            Send-BridgeProgress -Status 'starting_bridge' -Step 'bridge_bundle_fallback' -Message (Truncate-Message "Bridge bundle was unavailable, so the helper is falling back to the Pyrus repo build. $bundleError")
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
        Send-BridgeProgress -Status 'starting_bridge' -Step 'updating_repo' -Message 'Checking the local Pyrus bridge repo.'
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
        Send-BridgeProgress -Status 'starting_bridge' -Step 'cloning_repo' -Message 'Cloning the Pyrus bridge repo.'
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

function Get-BridgeHealthResult([string]$BaseUrl, [switch]$Quiet) {
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
        if (-not $Quiet) {
            Write-Log "Bridge check failed for $BaseUrl`: $($_.Exception.Message)"
        }
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

function Test-BridgeUrl([string]$BaseUrl, [switch]$Quiet) {
    $result = Get-BridgeHealthResult -BaseUrl $BaseUrl -Quiet:$Quiet
    return ($result.Healthy -eq $true)
}

function Get-BridgeHealthReconnectDetail($HealthResult) {
    if (-not $HealthResult) {
        return 'health unavailable'
    }

    $reason = ([string]$HealthResult.StrictReason).Trim()
    $lastError = ([string]$HealthResult.LastError).Trim()
    if ($reason -and $lastError) {
        return "$reason; $lastError"
    }
    if ($reason) {
        return $reason
    }
    if ($lastError) {
        return $lastError
    }
    return 'Gateway health check failed'
}

function Test-BridgeHealthNeedsGatewayReconnect($HealthResult) {
    if (-not $HealthResult) {
        return $false
    }

    $reason = ([string]$HealthResult.StrictReason).Trim()
    return @(
        'gateway_socket_disconnected',
        'gateway_server_disconnected',
        'gateway_login_required'
    ) -contains $reason
}

function Test-BridgeHealthCanAutoReconnectGateway($HealthResult) {
    if (-not (Test-BridgeHealthNeedsGatewayReconnect -HealthResult $HealthResult)) {
        return $false
    }

    if ($script:AutoLoginCredentialClaimed) {
        return $false
    }

    return $true
}

function Invoke-BridgeGatewayReconnectIfNeeded($HealthResult, [string]$Context) {
    if (-not (Test-BridgeHealthNeedsGatewayReconnect -HealthResult $HealthResult)) {
        return $false
    }

    $detail = Get-BridgeHealthReconnectDetail -HealthResult $HealthResult
    if (-not $script:UseAutoLogin) {
        throw "IB Gateway requires a reconnect ($detail). Stop and start IB Gateway, log in to live mode, then retry the bridge launch."
    }

    if ($script:GatewayRestartAttemptedForBridgeHealth) {
        throw "IB Gateway still requires a reconnect after one automatic restart ($detail). Start auto-login again from Pyrus so the helper receives a fresh one-time credential handoff."
    }

    if (-not (Test-BridgeHealthCanAutoReconnectGateway -HealthResult $HealthResult)) {
        throw "IB Gateway requires a fresh login ($detail), but this activation already used its one-time credential handoff. Start auto-login again from Pyrus so the helper receives a fresh one-time credential handoff."
    }

    $script:GatewayRestartAttemptedForBridgeHealth = $true
    $contextText = ''
    if ($Context) {
        $contextText = " during $Context"
    }
    Write-Log "Bridge health requires Gateway reconnect${contextText}: $detail"
    Send-BridgeProgress -Status 'waiting_gateway' -Step 'gateway_reconnect_required' -Message "Bridge health requires a fresh IB Gateway login ($detail). Restarting Gateway once before retrying the bridge."
    Stop-BridgeLaunchChildProcesses
    Stop-IBGatewayProcesses
    Ensure-IBGatewaySocket
    return $true
}

function Stop-ProcessFromPidFile([string]$PidFile, [string[]]$AllowedProcessNames = @()) {
    if (-not (Test-Path $PidFile)) {
        return
    }

    $pidValue = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pidValue -match '^\d+$') {
        $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
        if ($process) {
            $processName = [string]$process.ProcessName
            if (
                $AllowedProcessNames.Count -gt 0 -and
                -not ($AllowedProcessNames | Where-Object { $_ -ieq $processName })
            ) {
                Write-Log "PID file $PidFile points to $processName process $($process.Id); leaving it running."
            } else {
                Write-Log "Stopping stale $processName process $($process.Id) from PID file."
                Stop-Process -Id $process.Id -Force
            }
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

function Stop-StaleBridgeNodeProcesses {
    try {
        $repoPattern = [regex]::Escape($RepoDir)
        $entryPattern = 'artifacts(\\|/)ibkr-bridge(\\|/)dist(\\|/)index\.mjs'
        $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'nodejs.exe'" -OperationTimeoutSec 3 -ErrorAction Stop)
        foreach ($process in $processes) {
            $commandLine = [string]$process.CommandLine
            if (-not $commandLine) {
                continue
            }
            $normalized = $commandLine -replace '/', '\'
            $looksLikeBridge = (
                $normalized -match $entryPattern -or
                ($normalized -match $repoPattern -and $normalized -match 'ibkr-bridge')
            )
            if (-not $looksLikeBridge) {
                continue
            }
            $pidValue = [int]$process.ProcessId
            Write-Log "Stopping stale Pyrus local bridge node process $pidValue."
            Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Log "Stale bridge node process scan skipped: $($_.Exception.Message)"
    }
}

function Stop-BridgeLaunchChildProcesses {
    Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile -AllowedProcessNames @('cloudflared')
    Stop-ProcessFromPidFile -PidFile $BridgePidFile -AllowedProcessNames @('node', 'nodejs')
    Stop-BridgePortProcess
    Stop-StaleBridgeNodeProcesses
}

function Stop-IBKRDesktopBridgeAndGateway {
    Write-Log 'Stopping Pyrus IBKR bridge, Cloudflare tunnel, and IB Gateway.'
    Stop-BridgeLaunchChildProcesses
    Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
    Stop-IBGatewayProcesses
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
    } elseif (Invoke-BridgeGatewayReconnectIfNeeded -HealthResult $localHealth -Context 'existing local bridge health check') {
        Write-Log 'Gateway reconnect completed; retrying local bridge startup.'
    }

    $out = Join-Path $LogDir 'bridge.out.log'
    $err = Join-Path $LogDir 'bridge.err.log'
    $entry = Join-Path $RepoDir 'artifacts\ibkr-bridge\dist\index.mjs'

    :clientIdLoop foreach ($clientId in 101..105) {
        Send-BridgeProgress -Status 'starting_bridge' -Step 'preparing_bridge' -Message "Preparing the local IB Gateway bridge with client ID $clientId."
        Stop-ProcessFromPidFile -PidFile $BridgePidFile -AllowedProcessNames @('node', 'nodejs')
        Stop-BridgePortProcess
        Stop-StaleBridgeNodeProcesses
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
        $env:IBKR_BRIDGE_TOKEN = $script:BridgeToken
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
        $lastSocketWaitProgressAt = [DateTime]::MinValue
        while ((Get-Date) -lt $deadline) {
            Assert-ActivationNotCanceled
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
                    Send-BridgeProgress -Status 'starting_bridge' -Step 'local_bridge_ready' -Message "Local IB Gateway bridge is ready and streaming with client ID $clientId; publishing the Pyrus tunnel."
                } else {
                    Send-BridgeProgress -Status 'starting_bridge' -Step 'local_bridge_ready' -Message "Local IB Gateway bridge is ready with client ID $clientId; publishing the Pyrus tunnel."
                }
                return $localBaseUrl
            }
            $strictReason = ([string]$result.StrictReason).Trim()
            if ($strictReason -eq 'gateway_socket_disconnected') {
                if ($process.HasExited) {
                    $detail = Get-BridgeAttemptDetail -OutPath $out -ErrPath $err -HealthResult $lastHealthResult
                    Write-Log "Local bridge exited while waiting for Gateway API connection for client ID $clientId. $detail"
                    break
                }
                if (((Get-Date) - $lastSocketWaitProgressAt).TotalSeconds -ge 10) {
                    $lastSocketWaitProgressAt = Get-Date
                    Send-BridgeProgress -Status 'starting_bridge' -Step 'waiting_bridge_gateway_api' -Message "Waiting for the local bridge to finish connecting to IB Gateway with client ID $clientId."
                }
                Start-Sleep -Seconds 2
                continue
            }
            if (Invoke-BridgeGatewayReconnectIfNeeded -HealthResult $result -Context "local bridge client ID $clientId") {
                continue clientIdLoop
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
        Stop-ProcessFromPidFile -PidFile $BridgePidFile -AllowedProcessNames @('node', 'nodejs')
        Stop-BridgePortProcess
    }

    throw 'Local IB Gateway bridge did not become healthy with client IDs 101 through 105.'
}

function Ensure-CloudflareTunnel([string]$LocalBaseUrl) {
    if ($script:ForceFreshTunnel) {
        Write-Log 'Fresh tunnel requested; clearing cached Cloudflare quick tunnel state.'
        Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
        Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile -AllowedProcessNames @('cloudflared')
    } elseif (Test-Path $TunnelUrlFile) {
        $storedUrl = (Get-Content $TunnelUrlFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($storedUrl -and (Test-BridgeUrl -BaseUrl $storedUrl)) {
            Send-BridgeProgress -Status 'starting_tunnel' -Step 'tunnel_reused' -Message 'Reusing the existing Cloudflare quick tunnel.' -BridgeUrl $storedUrl
            return $storedUrl
        }
        Write-Log 'Cached Cloudflare quick tunnel is stale; clearing it before launching a new tunnel.'
        Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
        Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile -AllowedProcessNames @('cloudflared')
    }

    Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile -AllowedProcessNames @('cloudflared')

    $attempts = @(
        @{
            label = 'default'
            args = @('tunnel', '--url', $LocalBaseUrl)
            timeoutSeconds = 75
        },
        @{
            label = 'http2-ipv4'
            args = @('tunnel', '--url', $LocalBaseUrl, '--protocol', 'http2', '--edge-ip-version', '4')
            timeoutSeconds = 90
        },
        @{
            label = 'http2-auto-ip'
            args = @('tunnel', '--url', $LocalBaseUrl, '--protocol', 'http2', '--edge-ip-version', 'auto')
            timeoutSeconds = 90
        }
    )

    $publicUrl = $null
    $lastTunnelError = ''
    for ($attemptIndex = 0; $attemptIndex -lt $attempts.Count; $attemptIndex++) {
        $attempt = $attempts[$attemptIndex]
        Assert-ActivationNotCanceled
        $attemptLabel = [string]$attempt['label']
        $attemptArgs = [string[]]$attempt['args']
        $attemptTimeoutSeconds = [int]$attempt['timeoutSeconds']
        $out = Join-Path $LogDir "cloudflared.$attemptLabel.out.log"
        $err = Join-Path $LogDir "cloudflared.$attemptLabel.err.log"
        Remove-Item $out, $err -ErrorAction SilentlyContinue
        Send-BridgeProgress -Status 'starting_tunnel' -Step 'starting_tunnel' -Message "Starting a Cloudflare quick tunnel ($attemptLabel)."

        $process = Start-Process cloudflared `
            -ArgumentList $attemptArgs `
            -RedirectStandardOutput $out `
            -RedirectStandardError $err `
            -PassThru
        Set-Content -Path $CloudflaredPidFile -Value $process.Id

        $deadline = (Get-Date).AddSeconds($attemptTimeoutSeconds)
        while ((Get-Date) -lt $deadline -and -not $publicUrl) {
            Assert-ActivationNotCanceled
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
                $lastTunnelError = Truncate-Message "cloudflared attempt $attemptLabel exited before publishing a tunnel URL. $text" 900
                Write-Log $lastTunnelError
                break
            }
        }

        if ($publicUrl -and $process.HasExited) {
            $lastTunnelError = "cloudflared attempt $attemptLabel exited after publishing $publicUrl."
            Write-Log $lastTunnelError
            $publicUrl = $null
        }

        if ($publicUrl) {
            break
        }

        if (-not $process.HasExited) {
            $lastTunnelError = "Cloudflare quick tunnel attempt $attemptLabel did not publish a URL within $attemptTimeoutSeconds seconds."
            Write-Log $lastTunnelError
        }

        Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile -AllowedProcessNames @('cloudflared')
        if ($attemptIndex -lt ($attempts.Count - 1)) {
            Send-BridgeProgress -Status 'starting_tunnel' -Step 'retrying_tunnel' -Message (Truncate-Message "$lastTunnelError Retrying Cloudflare quick tunnel with alternate network settings.")
            Start-Sleep -Seconds 3
        }
    }

    if (-not $publicUrl) {
        if ($lastTunnelError) {
            throw $lastTunnelError
        }
        throw 'Cloudflare quick tunnel did not publish a URL in time.'
    }

    Set-Content -Path $TunnelUrlFile -Value $publicUrl
    Send-BridgeProgress -Status 'validating' -Step 'validating_tunnel' -Message 'Validating the public Cloudflare tunnel.' -BridgeUrl $publicUrl

    $validateDeadline = (Get-Date).AddSeconds(45)
    $lastValidationProgressAt = [DateTime]::MinValue
    while ((Get-Date) -lt $validateDeadline) {
        Assert-ActivationNotCanceled
        if (Test-BridgeUrl -BaseUrl $publicUrl -Quiet) {
            return $publicUrl
        }
        if (((Get-Date) - $lastValidationProgressAt).TotalSeconds -ge 10) {
            $lastValidationProgressAt = Get-Date
            Send-BridgeProgress -Status 'validating' -Step 'waiting_tunnel_dns' -Message 'Waiting for the Cloudflare tunnel DNS and health check to become reachable.' -BridgeUrl $publicUrl
        }
        Start-Sleep -Seconds 2
    }

    Remove-Item $TunnelUrlFile -ErrorAction SilentlyContinue
    Stop-ProcessFromPidFile -PidFile $CloudflaredPidFile -AllowedProcessNames @('cloudflared')
    throw 'Cloudflare quick tunnel is published but the bridge health check is not passing yet.'
}

try {
    if ($Install) {
        Install-ProtocolHandler
    }

    if ($InstallAgent) {
        Install-DesktopAgent -BaseUrl $ApiBaseUrl
        exit 0
    }

    if ($Agent) {
        Start-DesktopAgent -PreferredBaseUrl $ApiBaseUrl
        exit 0
    }

    $rawLaunchUrl = $LaunchUrl
    if (-not $rawLaunchUrl) {
        $rawLaunchUrl = $ActivationUrl
    }
    if (-not $rawLaunchUrl) {
        $rawLaunchUrl = $ProtocolUrl
    }

    if (-not $rawLaunchUrl) {
        Write-Log 'Protocol handler is installed. Start the IB Gateway bridge from the Pyrus header.'
        exit 0
    }

    $params = Parse-LaunchUrl -RawUrl $rawLaunchUrl
    $action = [string]$params['action']
    if ($action -eq 'configure-autologin') {
        throw 'Local stored IB Gateway auto-login setup is no longer used. Start auto-login from Pyrus and enter credentials in the app.'
    }
    if ($action -and $action -ne 'launch') {
        throw "Unsupported pyrus-ibkr action '$action'."
    }

    $script:ActivationId = [string]$params['activationId']
    $script:CallbackSecret = [string]$params['callbackSecret']
    $script:ApiBaseUrl = (Get-RequiredParam -Params $params -Name 'apiBaseUrl').TrimEnd('/')
    Save-DesktopAgentConfig -BaseUrl $script:ApiBaseUrl
    Invoke-HelperSelfUpdateIfNeeded -Params $params -RawLaunchUrl $rawLaunchUrl
    if (Test-TruthyParam $params['shutdown']) {
        Write-Log 'IBKR shutdown requested by Pyrus.'
        $shutdownJobId = [string]$params['jobId']
        $shutdownCompletionToken = [string]$params['completionToken']
        try {
            Stop-IBKRDesktopBridgeAndGateway
            Complete-DesktopAgentJob -BaseUrl $script:ApiBaseUrl -JobId $shutdownJobId -CompletionToken $shutdownCompletionToken -Ok $true -Message 'IBKR bridge, tunnel, and Gateway shutdown completed.'
        } catch {
            Complete-DesktopAgentJob -BaseUrl $script:ApiBaseUrl -JobId $shutdownJobId -CompletionToken $shutdownCompletionToken -Ok $false -Message $_.Exception.Message
            throw
        }
        exit 0
    }

    $script:BridgeToken = Get-OrCreate-BridgeToken -PreferredToken (Get-RequiredParam -Params $params -Name 'bridgeToken')
    $script:ManagementToken = [string]$params['managementToken']
    $script:ForceFreshTunnel = Test-TruthyParam $params['forceFreshTunnel']
    $script:UseAutoLogin = Test-TruthyParam $params['autoLogin']
    if ($script:UseAutoLogin -and $params['autoLoginMode'] -and [string]$params['autoLoginMode'] -ne 'ib-gateway-live') {
        throw "Unsupported IB Gateway auto-login mode '$($params['autoLoginMode'])'."
    }
    if ($script:UseAutoLogin -and [string]$params['loginMode'] -ne 'ui-onetime') {
        throw 'IB Gateway auto-login now requires the Pyrus one-time credential handoff. Start auto-login again from the current app UI.'
    }

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
    $desktopAgentPaired = $false
    try {
        Register-DesktopAgent -BaseUrl $script:ApiBaseUrl -ActivationId $script:ActivationId -CallbackSecret $script:CallbackSecret | Out-Null
        $desktopAgentPaired = $true
    } catch {
        Write-Log "Desktop agent registration failed: $($_.Exception.Message)"
    }
    Ensure-IBGatewaySocket
    Ensure-RepoAndBridgeBuild
    $localBaseUrl = Ensure-LocalBridge
    $publicUrl = Ensure-CloudflareTunnel -LocalBaseUrl $localBaseUrl
    Complete-BridgeAttach -BridgeUrl $publicUrl
    Send-BridgeProgress -Status 'connected' -Step 'connected' -Message 'IB Gateway bridge attached.' -BridgeUrl $publicUrl
    try {
        Install-DesktopAgent -BaseUrl $script:ApiBaseUrl
    } catch {
        Write-Log "Desktop agent install failed: $($_.Exception.Message)"
        if ($desktopAgentPaired) {
            try {
                Write-Log 'Attempting current-user Startup fallback for the paired desktop agent.'
                Install-DesktopAgentStartupFallback -BaseUrl $script:ApiBaseUrl
                Start-DesktopAgentProcess -BaseUrl $script:ApiBaseUrl
            } catch {
                Write-Log "Desktop agent Startup fallback failed: $($_.Exception.Message)"
            }
        } else {
            Write-Log 'Desktop agent Startup fallback skipped because this desktop did not pair with the API.'
        }
    }
    Write-Log "IB Gateway bridge attached with $publicUrl."
} catch {
    $message = $_.Exception.Message
    Write-Log "IB Gateway bridge launch failed: $message"
    Stop-BridgeLaunchChildProcesses
    Send-BridgeProgress -Status 'error' -Step 'error' -Message $message
    throw
}
