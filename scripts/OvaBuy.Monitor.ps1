# OvaBuy.Monitor.ps1 — cheap status probes for Launch Control (dot-source from GUI + runspace).

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

function Get-OvaBuyPaths {
    param([string]$ScriptDir)
    $repoRoot = Split-Path -Parent $ScriptDir
    @{
        ScriptDir   = $ScriptDir
        RepoRoot    = $repoRoot
        LogRoot     = Join-Path $env:LOCALAPPDATA "OvaBuy\logs"
        LiveLog     = Join-Path $env:LOCALAPPDATA "OvaBuy\logs\launch-control-live.log"
        DevServerLog = Join-Path $env:LOCALAPPDATA "OvaBuy\logs\dev-server.log"
        DiagnosticsFlag = Join-Path $env:LOCALAPPDATA "OvaBuy\logs\diagnostics.enabled"
        EnvFile     = Join-Path $repoRoot ".env"
        EnvExample  = Join-Path $repoRoot ".env.example"
        Database    = Join-Path $repoRoot "prisma\dev.db"
        Url         = "http://127.0.0.1:43123"
        Port        = 43123
    }
}

function Test-OvaBuyPortListening {
    param([int]$Port = 43123)
    try {
        $lines = netstat -ano -p tcp 2>$null | Select-String ":$Port\s" | Select-String "LISTENING"
        foreach ($line in $lines) {
            if ($line -match '\s+(\d+)\s*$') { return [int]$Matches[1] }
        }
    }
    catch { }
    return 0
}

function Test-OvaBuyHealth {
    param(
        [string]$Url = "http://127.0.0.1:43123/login",
        [int]$TimeoutSec = 3
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $req = [System.Net.WebRequest]::Create($Url)
        $req.Method = "GET"
        $req.Timeout = $TimeoutSec * 1000
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        $sw.Stop()
        return @{
            Ok = ($code -ge 200 -and $code -lt 400)
            StatusCode = $code
            LatencyMs = [int]$sw.ElapsedMilliseconds
            Error = $null
        }
    }
    catch {
        $sw.Stop()
        return @{
            Ok = $false
            StatusCode = 0
            LatencyMs = [int]$sw.ElapsedMilliseconds
            Error = $_.Exception.Message
        }
    }
}

function Get-OvaBuyNodeVersion {
    try {
        $v = & node --version 2>$null
        if ($v) { return $v.Trim() }
    }
    catch { }
    return $null
}

function Get-OvaBuyRuntimeSnapshot {
    param(
        [string]$RepoRoot,
        [string]$Url = "http://127.0.0.1:43123",
        [int]$Port = 43123
    )
    $pid = Test-OvaBuyPortListening -Port $Port
    $health = if ($pid -gt 0) { Test-OvaBuyHealth -Url "$Url/login" } else { $null }
    $node = Get-OvaBuyNodeVersion

    $status = "Stopped"
    if ($pid -gt 0) {
        if ($health -and $health.Ok) { $status = "Running" }
        elseif ($health) { $status = "Unreachable" }
        else { $status = "Starting" }
    }

    [pscustomobject]@{
        Status      = $status
        Pid         = $pid
        HealthOk    = if ($health) { $health.Ok } else { $null }
        HealthMs    = if ($health) { $health.LatencyMs } else { $null }
        HealthError = if ($health) { $health.Error } else { $null }
        NodeVersion = $node
        HasNodeModules = Test-Path (Join-Path $RepoRoot "node_modules")
        HasDatabase = Test-Path (Join-Path $RepoRoot "prisma\dev.db")
        HasEnv = Test-Path (Join-Path $RepoRoot ".env")
        CheckedAt   = Get-Date
    }
}

function Stop-OvaBuyServer {
    param([int]$Port = 43123)
    $killed = @()
    try {
        $lines = netstat -ano -p tcp 2>$null | Select-String ":$Port\s" | Select-String "LISTENING"
        foreach ($line in $lines) {
            if ($line -match '\s+(\d+)\s*$') {
                $procId = [int]$Matches[1]
                if ($procId -gt 0 -and $killed -notcontains $procId) {
                    & taskkill.exe /PID $procId /T /F 2>$null | Out-Null
                    $killed += $procId
                }
            }
        }
    }
    catch { }
    return $killed
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
        $lines = $text -split "`r?`n" | Where-Object { $_ -ne "" }
        return @{ Lines = $lines; NewOffset = $fs.Length }
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
