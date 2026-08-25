# OvaBuy redeploy after git sync: install deps, migrate DB, build, restart (preserves .env).
param(
    [string]$RepoRoot = "",
    [string]$SessionLog = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}

. (Join-Path $PSScriptRoot "OvaBuy.Monitor.ps1")
$paths = Get-OvaBuyPaths -ScriptDir $PSScriptRoot

if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    throw "package.json not found in $RepoRoot"
}

$logRoot = $paths.LogRoot
if (-not (Test-Path -LiteralPath $logRoot)) {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
}

if ([string]::IsNullOrWhiteSpace($SessionLog)) {
    $SessionLog = Join-Path $logRoot ("redeploy-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
}
$liveLog = $paths.LiveLog

function Write-RedeployLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet("INFO", "WARN", "ERROR", "STEP", "OK")]
        [string]$Level = "INFO"
    )
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] [{1}] {2}" -f (Get-Date), $Level, $Message
    Add-Content -LiteralPath $SessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $liveLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Invoke-NpmStep {
    param(
        [Parameter(Mandatory)][string]$Arguments,
        [Parameter(Mandatory)][string]$StepLabel
    )
    Write-RedeployLog $StepLabel -Level STEP
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = "npm" }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $npm
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    foreach ($line in (($out + "`n" + $err) -split "`r?`n")) {
        if ($line.Trim()) { Write-RedeployLog $line.Trim() }
    }
    if ($p.ExitCode -ne 0) {
        Write-RedeployLog "npm $Arguments failed (exit $($p.ExitCode))" -Level ERROR
        Write-RedeployLog "OVABUY_REDEPLOY_FAIL" -Level ERROR
        exit 1
    }
}

try {
    if (-not (Test-Path -LiteralPath $SessionLog)) {
        Set-Content -LiteralPath $SessionLog -Value "" -Encoding UTF8
    }

    Write-RedeployLog "OvaBuy redeploy starting (config preserved: .env is not modified)" -Level STEP
    Write-RedeployLog "Repo: $RepoRoot"

    Ensure-OvaBuyEnvFile -Paths $paths | Out-Null

    Write-RedeployLog "Stopping server on port $($paths.Port)" -Level STEP
    Stop-OvaBuyServer -Port $paths.Port | Out-Null
    Clear-OvaBuyServerPid -Paths $paths

    Invoke-NpmStep -Arguments "install" -StepLabel "npm install"
    Invoke-NpmStep -Arguments "run db:deploy" -StepLabel "Database migrate (prisma migrate deploy)"
    Invoke-NpmStep -Arguments "run build" -StepLabel "Production build (next build)"

    Write-RedeployLog "Starting production server (npm run start)" -Level STEP
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = "npm" }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $npm
    $psi.Arguments = "run start"
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    Start-OvaBuyServerLogPump -Process $proc -LogPath $paths.DevServerLog
    Save-OvaBuyServerPid -Paths $paths -ProcessId $proc.Id -Mode "prod"

    Write-RedeployLog "Waiting for /api/health (up to 120s)" -Level STEP
    $deadline = (Get-Date).AddSeconds(120)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        $health = Test-OvaBuyHealth -Url "$($paths.Url)/api/health" -TimeoutSec 3
        if ($health.Ok) {
            $healthy = $true
            $ver = Get-OvaBuyHealthVersion -Url "$($paths.Url)/api/health"
            Write-RedeployLog "Health OK ($($health.LatencyMs)ms) version=$ver" -Level OK
            break
        }
        Start-Sleep -Seconds 2
    }

    if (-not $healthy) {
        Write-RedeployLog "Health check failed after redeploy" -Level ERROR
        Write-RedeployLog "OVABUY_REDEPLOY_FAIL" -Level ERROR
        exit 1
    }

    Write-RedeployLog "OVABUY_REDEPLOY_OK" -Level OK
    exit 0
}
catch {
    Write-RedeployLog $_.Exception.Message -Level ERROR
    Write-RedeployLog "OVABUY_REDEPLOY_FAIL" -Level ERROR
    exit 1
}
