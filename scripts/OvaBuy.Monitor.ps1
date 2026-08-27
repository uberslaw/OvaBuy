# OvaBuy.Monitor.ps1 - status probes for Launch Control (dot-source from GUI + runspace).

function Hide-OvaBuyHostConsole {
    try {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OvaBuyConsole {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue | Out-Null
        $hwnd = [OvaBuyConsole]::GetConsoleWindow()
        if ($hwnd -ne [IntPtr]::Zero) {
            [void][OvaBuyConsole]::ShowWindow($hwnd, 0)
        }
    }
    catch { }
}

function Expand-OvaBuyEnvPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    return $expanded
}

function Get-OvaBuyLaunchControlManifest {
    param([string]$ScriptDir)
    $manifestPath = Join-Path $ScriptDir "launch-control.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        return $raw
    }
    catch {
        return $null
    }
}

function Get-OvaBuyPaths {
    param([string]$ScriptDir)
    $repoRoot = Split-Path -Parent $ScriptDir
    $manifest = Get-OvaBuyLaunchControlManifest -ScriptDir $ScriptDir
    $logRoot = Join-Path $repoRoot "logs"
    $url = if ($manifest -and $manifest.browserUrl) { $manifest.browserUrl.TrimEnd('/') } else { "http://127.0.0.1:43123" }
    $healthUrl = if ($manifest -and $manifest.healthUrl) { $manifest.healthUrl } else { "$url/api/health" }
  @{
        ScriptDir   = $ScriptDir
        RepoRoot    = $repoRoot
        LogRoot     = $logRoot
        LiveLog     = Join-Path $logRoot "launch-control-live.log"
        DevServerLog = Join-Path $logRoot "dev-server.log"
        RedeployDeployLog = Join-Path $logRoot "redeploy-deploy.log"
        DiagnosticsFlag = if ($manifest -and $manifest.diagnosticsFlagPath) {
            Expand-OvaBuyEnvPath $manifest.diagnosticsFlagPath
        } else {
            Join-Path $logRoot "diagnostics.enabled"
        }
        PidFile     = Join-Path $logRoot "ovabuy-server.pid"
        ModeFile    = Join-Path $logRoot "ovabuy-server.mode"
        EnvFile     = Join-Path $repoRoot ".env"
        EnvExample  = Join-Path $repoRoot ".env.example"
        Database    = Join-Path $repoRoot "prisma\dev.db"
        Url         = $url
        HealthUrl   = $healthUrl
        Port        = 43123
        Manifest    = $manifest
    }
}

function Get-OvaBuyAppVersion {
    param([string]$RepoRoot)
    try {
        $pkgPath = Join-Path $RepoRoot "package.json"
        if (-not (Test-Path -LiteralPath $pkgPath)) { return $null }
        $pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($pkg.version) { return [string]$pkg.version }
    }
    catch { }
    return $null
}

function Test-OvaBuyPortListening {
    param([int]$Port = 43123)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($conn -and $conn.OwningProcess -gt 0) {
            return [int]$conn.OwningProcess
        }
    }
    catch { }

    try {
        $lines = @(netstat -ano -p tcp 2>$null)
        foreach ($line in $lines) {
            if ($line -notmatch 'LISTENING') { continue }
            # Match local endpoint ...:43123 with trailing whitespace before remote endpoint
            if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
                return [int]$Matches[1]
            }
        }
    }
    catch { }
    return 0
}

function Stop-OvaBuyServer {
    param([int]$Port = 43123)
    $result = @{
        Killed = @()
        Failed = @()
        Found  = @()
    }

    try {
        $result.Found += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    }
    catch { }

    if ($result.Found.Count -eq 0) {
        try {
            $lines = @(netstat -ano -p tcp 2>$null)
            foreach ($line in $lines) {
                if ($line -notmatch 'LISTENING') { continue }
                if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
                    $result.Found += [int]$Matches[1]
                }
            }
        }
        catch { }
    }

    $result.Found = @($result.Found | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    foreach ($procId in $result.Found) {
        $out = & taskkill.exe /PID $procId /T /F 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) {
            $result.Killed += $procId
        }
        else {
            $result.Failed += @{ Pid = $procId; Detail = $out.Trim() }
        }
    }
    return $result
}

function Test-OvaBuyHealth {
    param(
        [string]$Url = "http://127.0.0.1:43123/api/health",
        [int]$TimeoutSec = 3
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $req = [System.Net.WebRequest]::Create($Url)
        $req.Method = "GET"
        $req.Timeout = $TimeoutSec * 1000
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()
        $sw.Stop()
        return @{
            Ok = ($code -ge 200 -and $code -lt 400)
            StatusCode = $code
            LatencyMs = [int]$sw.ElapsedMilliseconds
            Body = $body
            Error = $null
        }
    }
    catch {
        $sw.Stop()
        return @{
            Ok = $false
            StatusCode = 0
            LatencyMs = [int]$sw.ElapsedMilliseconds
            Body = $null
            Error = $_.Exception.Message
        }
    }
}

function Get-OvaBuyHealthVersion {
    param([string]$Url = "http://127.0.0.1:43123/api/health")
    $health = Test-OvaBuyHealth -Url $Url
    if (-not $health.Ok -or -not $health.Body) { return $null }
    try {
        $json = $health.Body | ConvertFrom-Json
        if ($json.productVersion) { return [string]$json.productVersion }
        if ($json.version) { return "OvaBuy $($json.version)" }
    }
    catch { }
    return $null
}

function Get-OvaBuyNodeVersion {
    try {
        $v = & node --version 2>$null
        if ($v) { return $v.Trim() }
    }
    catch { }
    return $null
}

function Get-OvaBuyServerMode {
    param($Paths)
    if (Test-Path -LiteralPath $Paths.ModeFile) {
        $mode = (Get-Content -LiteralPath $Paths.ModeFile -Raw).Trim().ToLowerInvariant()
        if ($mode -in @("dev", "prod")) { return $mode }
    }
    return "dev"
}

function Set-OvaBuyServerMode {
    param(
        $Paths,
        [ValidateSet("dev", "prod")]
        [string]$Mode
    )
    if (-not (Test-Path -LiteralPath $Paths.LogRoot)) {
        New-Item -ItemType Directory -Path $Paths.LogRoot -Force | Out-Null
    }
    Set-Content -LiteralPath $Paths.ModeFile -Value $Mode -Encoding UTF8 -NoNewline
}

function Save-OvaBuyServerPid {
    param(
        $Paths,
        [int]$ProcessId,
        [ValidateSet("dev", "prod")]
        [string]$Mode = "dev"
    )
    if (-not (Test-Path -LiteralPath $Paths.LogRoot)) {
        New-Item -ItemType Directory -Path $Paths.LogRoot -Force | Out-Null
    }
    Set-Content -LiteralPath $Paths.PidFile -Value $ProcessId -Encoding UTF8 -NoNewline
    Set-OvaBuyServerMode -Paths $Paths -Mode $Mode
}

function Clear-OvaBuyServerPid {
    param($Paths)
    if (Test-Path -LiteralPath $Paths.PidFile) {
        Remove-Item -LiteralPath $Paths.PidFile -Force -ErrorAction SilentlyContinue
    }
}

function Start-OvaBuyServerLogPump {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$LogPath
    )
    $p = $Process
    $logPath = $LogPath
    [System.Threading.Tasks.Task]::Run([Action]{
        $sw = [System.IO.StreamWriter]::new($logPath, $true, [System.Text.Encoding]::UTF8)
        try {
            $stdout = $p.StandardOutput
            $stderr = $p.StandardError
            while (-not $p.HasExited) {
                while ($stdout.Peek() -ge 0) {
                    $line = $stdout.ReadLine()
                    if ($null -ne $line) { $sw.WriteLine($line); $sw.Flush() }
                }
                while ($stderr.Peek() -ge 0) {
                    $line = $stderr.ReadLine()
                    if ($null -ne $line) { $sw.WriteLine($line); $sw.Flush() }
                }
                Start-Sleep -Milliseconds 100
            }
            while (-not $stdout.EndOfStream) {
                $line = $stdout.ReadLine()
                if ($null -ne $line) { $sw.WriteLine($line); $sw.Flush() }
            }
            while (-not $stderr.EndOfStream) {
                $line = $stderr.ReadLine()
                if ($null -ne $line) { $sw.WriteLine($line); $sw.Flush() }
            }
        }
        catch { }
        finally { $sw.Close() }
    }) | Out-Null
}

function Get-OvaBuyRuntimeSnapshot {
    param(
        [string]$RepoRoot,
        [string]$Url = "http://127.0.0.1:43123",
        [int]$Port = 43123,
        [string]$HealthUrl = ""
    )
    if (-not $HealthUrl) { $HealthUrl = "$Url/api/health" }
    $listenPid = Test-OvaBuyPortListening -Port $Port
    $health = $null
    if ($listenPid -gt 0) {
        $health = Test-OvaBuyHealth -Url $HealthUrl
        if (-not $health.Ok) {
            $loginProbe = Test-OvaBuyHealth -Url "$Url/login"
            if ($loginProbe.Ok) { $health = $loginProbe }
        }
    }
    $node = Get-OvaBuyNodeVersion
    $appVersion = Get-OvaBuyAppVersion -RepoRoot $RepoRoot
    $liveVersion = if ($health -and $health.Ok) { Get-OvaBuyHealthVersion -Url $HealthUrl } else { $null }

    $status = "Stopped"
    if ($listenPid -gt 0) {
        if ($health -and $health.Ok) { $status = "Running" }
        else { $status = "Starting" }
    }

    [pscustomobject]@{
        Status      = $status
        Pid         = $listenPid
        HealthOk    = if ($health) { $health.Ok } else { $null }
        HealthMs    = if ($health) { $health.LatencyMs } else { $null }
        HealthError = if ($health) { $health.Error } else { $null }
        AppVersion  = if ($liveVersion) { $liveVersion } elseif ($appVersion) { "OvaBuy $appVersion" } else { $null }
        NodeVersion = $node
        HasNodeModules = Test-Path (Join-Path $RepoRoot "node_modules")
        HasDatabase = Test-Path (Join-Path $RepoRoot "prisma\dev.db")
        HasEnv = Test-Path (Join-Path $RepoRoot ".env")
        CheckedAt   = Get-Date
    }
}

function Get-OvaBuyFileTail {
    param(
        [string]$Path,
        [long]$AfterOffset = 0,
        [int]$MaxBytes = 65536
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        return @{ Lines = @(); NewOffset = 0 }
    }
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        if ($AfterOffset -gt $fs.Length) { $AfterOffset = 0 }
        $readLen = [Math]::Min($MaxBytes, $fs.Length - $AfterOffset)
        if ($readLen -le 0) { return @{ Lines = @(); NewOffset = $fs.Length } }
        $fs.Seek($AfterOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
        $buf = New-Object byte[] $readLen
        [void]$fs.Read($buf, 0, $readLen)
        $text = [System.Text.Encoding]::UTF8.GetString($buf)
        $parts = $text -split "`r?`n"
        $lines = @()
        if ($parts.Count -gt 1) {
            $lines = $parts[0..($parts.Count - 2)] | Where-Object { $_ -ne "" }
        }
        $carry = $parts[$parts.Count - 1]
        if ($fs.Length -eq ($AfterOffset + $readLen) -and $carry) {
            $lines += $carry
            $carry = ""
        }
        return @{ Lines = $lines; NewOffset = $fs.Length - $carry.Length; Carry = $carry }
    }
    finally {
        $fs.Close()
    }
}

function Ensure-OvaBuyEnvFile {
    param($Paths)
    if (Test-Path -LiteralPath $Paths.EnvFile) { return $Paths.EnvFile }
    if (Test-Path -LiteralPath $Paths.EnvExample) {
        Copy-Item -LiteralPath $Paths.EnvExample -Destination $Paths.EnvFile -Force
        return $Paths.EnvFile
    }
    @"
DATABASE_URL="file:./dev.db"
AUTH_SECRET="ovabuy-dev-secret-change-in-production"
NEXTAUTH_URL="$($Paths.Url)"
"@ | Set-Content -LiteralPath $Paths.EnvFile -Encoding UTF8
    return $Paths.EnvFile
}
