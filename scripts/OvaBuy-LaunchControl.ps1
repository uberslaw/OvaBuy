#Requires -Version 5.1
<#
.SYNOPSIS
  OvaBuy Launch Control - service start/stop, redeploy, logs, and status for the APAC ordering PoC.

.DESCRIPTION
  WinForms ops UI. Logs under %LOCALAPPDATA%\OvaBuy\logs\.
  Entry: scripts\OvaBuy-LaunchControl.cmd (hidden STA PowerShell) or Master Launch Control Generic card.
#>
param(
    [ValidateSet("Menu", "Start", "Stop", "Restart", "Setup", "Open", "OpenLogs", "Status", "Redeploy")]
    [string]$Mode = "Menu",
    [switch]$ActionOnly
)

if ($args.Count -gt 0 -and $Mode -eq "Menu" -and -not $ActionOnly) {
    $map = @{
        start    = "Start"
        stop     = "Stop"
        restart  = "Restart"
        setup    = "Setup"
        open     = "Open"
        openlogs = "OpenLogs"
        status   = "Status"
        redeploy = "Redeploy"
    }
    $key = $args[0].ToString().ToLowerInvariant()
    if ($map.ContainsKey($key)) {
        $Mode = $map[$key]
        $ActionOnly = $true
    }
}

$ErrorActionPreference = "Stop"

$script:ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $script:ScriptDir "OvaBuy.Monitor.ps1")

$script:Paths = Get-OvaBuyPaths -ScriptDir $script:ScriptDir
$script:RepoRoot = $script:Paths.RepoRoot
$script:LogRoot = $script:Paths.LogRoot
$script:LogPath = $null
$script:UiLogBox = $null
$script:UiStatusBig = $null
$script:UiHealthBar = $null
$script:UiPid = $null
$script:UiVersion = $null
$script:UiLastChange = $null
$script:LaunchControlBusy = $false
$script:FollowLogs = $false
$script:DevLogOffset = 0
$script:DevLogCarry = ""
$script:LastSnapshotStatus = $null
$script:PendingEventLines = $null
$script:StatusPollIntervalMs = 2500
$script:LastStatusPollUtc = [DateTime]::MinValue
$script:LatestSnapshot = $null
$script:DevServerProcess = $null
$script:MaxEventChars = 80000
$script:ActionButtons = @()
$script:WinFormsReady = $false

function Initialize-OvaBuyWinForms {
    if ($script:WinFormsReady) { return }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    Hide-OvaBuyHostConsole
    $script:PendingEventLines = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
    $script:WinFormsReady = $true
}

function Initialize-OvaBuyLogging {
    param([string]$Prefix = "launch-control")
    if (-not (Test-Path -LiteralPath $script:LogRoot)) {
        New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null
    }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:LogPath = Join-Path $script:LogRoot "$Prefix-$stamp.log"
    $header = @"

================================================================
  OvaBuy Launch Control
================================================================
Log: $($script:LogPath)
Live: $($script:Paths.LiveLog)
User: $env:USERNAME | Machine: $env:COMPUTERNAME
Repo: $($script:RepoRoot)
URL:  $($script:Paths.Url)
Started: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

"@
    Add-Content -LiteralPath $script:LogPath -Value $header -Encoding UTF8
    return $script:LogPath
}

function Write-OvaBuyLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet("INFO", "WARN", "ERROR", "STEP", "OK")]
        [string]$Level = "INFO"
    )
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    if ($script:LogPath) {
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
    }
    try {
        if (-not (Test-Path -LiteralPath $script:LogRoot)) {
            New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null
        }
        Add-Content -LiteralPath $script:Paths.LiveLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    }
    catch { }

    $showInUi = $Level -in @("WARN", "ERROR", "STEP", "OK") -or $script:FollowLogs
    if ($showInUi -and $script:PendingEventLines) {
        [void]$script:PendingEventLines.Enqueue($line)
    }
}

function Set-LaunchControlBusy {
    param([bool]$Busy)
    $script:LaunchControlBusy = $Busy
    foreach ($btn in $script:ActionButtons) {
        if ($btn -and -not $btn.IsDisposed) {
            $btn.Enabled = -not $Busy
        }
    }
    [System.Windows.Forms.Application]::DoEvents()
}

function Test-IsAdministrator {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-NpmLogged {
    param(
        [Parameter(Mandatory)][string]$Arguments,
        [string]$StepLabel
    )
    if ($StepLabel) { Write-OvaBuyLog $StepLabel -Level STEP }
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = "npm" }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $npm
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $script:RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    foreach ($line in ($out -split "`r?`n")) {
        if ($line.Trim()) { Write-OvaBuyLog $line }
    }
    foreach ($line in ($err -split "`r?`n")) {
        if ($line.Trim()) { Write-OvaBuyLog $line -Level WARN }
    }
    if ($p.ExitCode -ne 0) {
        throw "npm $Arguments failed (exit $($p.ExitCode))"
    }
}

function Start-OvaBuySetup {
    if (-not (Test-Path (Join-Path $script:RepoRoot "package.json"))) {
        throw "package.json not found in $($script:RepoRoot)"
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js not found. Install Node 20+ from https://nodejs.org/"
    }
    Ensure-OvaBuyEnvFile -Paths $script:Paths | Out-Null
    if (-not (Test-Path (Join-Path $script:RepoRoot "node_modules"))) {
        Invoke-NpmLogged -Arguments "install" -StepLabel "npm install"
    }
    else {
        Write-OvaBuyLog "node_modules present - skipping npm install"
    }
    Invoke-NpmLogged -Arguments "run db:deploy" -StepLabel "Database migrate (prisma migrate deploy)"
    Invoke-NpmLogged -Arguments "run db:seed" -StepLabel "Seed demo data"
    Write-OvaBuyLog "Setup complete. Demo: cs.singapore@demo.local / demo123" -Level OK
}

function Start-OvaBuyServerProcess {
    param(
        [ValidateSet("dev", "prod")]
        [string]$ServerMode = "dev"
    )
    if ($script:DevServerProcess -and -not $script:DevServerProcess.HasExited) {
        Write-OvaBuyLog "Server process already tracked (PID $($script:DevServerProcess.Id))" -Level WARN
        return
    }
    $listenPid = Test-OvaBuyPortListening -Port $script:Paths.Port
    if ($listenPid -gt 0) {
        Write-OvaBuyLog "Port $($script:Paths.Port) already in use (PID $listenPid)" -Level WARN
        return
    }
    if (-not (Test-Path (Join-Path $script:RepoRoot "node_modules"))) {
        Start-OvaBuySetup
    }
    elseif (-not (Test-Path $script:Paths.Database)) {
        Invoke-NpmLogged -Arguments "run db:deploy" -StepLabel "Database migrate"
        Invoke-NpmLogged -Arguments "run db:seed" -StepLabel "Seed demo data"
    }
    Ensure-OvaBuyEnvFile -Paths $script:Paths | Out-Null

    if (-not (Test-Path -LiteralPath $script:LogRoot)) {
        New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null
    }

    $npmArgs = if ($ServerMode -eq "prod") { "run start" } else { "run dev" }
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = "npm" }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $npm
    $psi.Arguments = $npmArgs
    $psi.WorkingDirectory = $script:RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $script:DevServerProcess = [System.Diagnostics.Process]::Start($psi)
    Start-OvaBuyServerLogPump -Process $script:DevServerProcess -LogPath $script:Paths.DevServerLog
    Save-OvaBuyServerPid -Paths $script:Paths -ProcessId $script:DevServerProcess.Id -Mode $ServerMode

    Write-OvaBuyLog "Service starting ($ServerMode) on $($script:Paths.Url) (npm PID $($script:DevServerProcess.Id))" -Level OK
    Write-OvaBuyLog "Server log: $($script:Paths.DevServerLog)"
}

function Start-OvaBuyDevServer {
    $mode = Get-OvaBuyServerMode -Paths $script:Paths
    Start-OvaBuyServerProcess -ServerMode $mode
}

function Stop-OvaBuyDevServer {
    $killed = Stop-OvaBuyServer -Port $script:Paths.Port
    if ($script:DevServerProcess -and -not $script:DevServerProcess.HasExited) {
        try { $script:DevServerProcess.Kill($true) } catch { }
    }
    $script:DevServerProcess = $null
    Clear-OvaBuyServerPid -Paths $script:Paths
    if ($killed.Count -gt 0) {
        Write-OvaBuyLog "Stopped listener(s) on port $($script:Paths.Port): $($killed -join ', ')" -Level OK
    }
    else {
        Write-OvaBuyLog "No listener on port $($script:Paths.Port)" -Level INFO
    }
}

function Start-OvaBuyRedeploy {
    $redeployPs1 = Join-Path $script:ScriptDir "OvaBuy-Redeploy.ps1"
    if (-not (Test-Path -LiteralPath $redeployPs1)) {
        throw "Redeploy script not found: $redeployPs1"
    }

    $sessionLog = Join-Path $script:LogRoot ("redeploy-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
    Set-Content -LiteralPath $sessionLog -Value "" -Encoding UTF8
    Write-OvaBuyLog "Redeploy after git sync (preserves .env)" -Level STEP
    Write-OvaBuyLog "Session log: $sessionLog"
    Write-OvaBuyLog "Steps: stop -> npm install -> db deploy -> build -> start -> health" -Level INFO

    $psArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $redeployPs1,
        "-RepoRoot", $script:RepoRoot,
        "-SessionLog", $sessionLog
    )
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs `
        -WorkingDirectory $script:ScriptDir -PassThru -WindowStyle Hidden -Wait

    $ok = $false
    if (Test-Path -LiteralPath $sessionLog) {
        $ok = Select-String -LiteralPath $sessionLog -Pattern "OVABUY_REDEPLOY_OK" -Quiet -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $sessionLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_ -match '\[(STEP|OK|WARN|ERROR)\]') {
                $level = $Matches[1]
                $msg = ($_ -replace '^\[[^\]]+\]\s+\[[^\]]+\]\s+', '')
                Write-OvaBuyLog $msg -Level $level
            }
        }
    }

    $script:DevServerProcess = $null
    if ($ok) {
        Set-OvaBuyServerMode -Paths $script:Paths -Mode "prod"
        Write-OvaBuyLog "Redeploy complete" -Level OK
    }
    else {
        throw "Redeploy failed (exit $($p.ExitCode)). See $sessionLog"
    }
}

function Open-OvaBuyLogsFolder {
    if (-not (Test-Path -LiteralPath $script:LogRoot)) {
        New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null
    }
    Start-Process explorer.exe $script:LogRoot | Out-Null
    Write-OvaBuyLog "Opened logs folder: $script:LogRoot"
}

function Open-OvaBuyBrowser {
    Start-Process "$($script:Paths.Url)/login" | Out-Null
    Write-OvaBuyLog "Opened browser: $($script:Paths.Url)/login"
}

function Set-DiagnosticsEnabled {
    param([bool]$Enabled)
    $flag = $script:Paths.DiagnosticsFlag
    if ($Enabled) {
        if (-not (Test-Path -LiteralPath $script:LogRoot)) {
            New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null
        }
        Set-Content -LiteralPath $flag -Value (Get-Date -Format "o") -Encoding UTF8
        Write-OvaBuyLog "Diagnostics logging enabled ($flag)" -Level OK
    }
    elseif (Test-Path -LiteralPath $flag) {
        Remove-Item -LiteralPath $flag -Force
        Write-OvaBuyLog "Diagnostics logging disabled" -Level OK
    }
}

function Test-DiagnosticsEnabled {
    return Test-Path -LiteralPath $script:Paths.DiagnosticsFlag
}

function Update-StatusUi {
    param($Snapshot)
    $script:LatestSnapshot = $Snapshot
    if ($script:UiStatusBig) {
        $script:UiStatusBig.Text = $Snapshot.Status
        $script:UiStatusBig.ForeColor = switch ($Snapshot.Status) {
            "Running"     { [System.Drawing.Color]::FromArgb(143, 219, 168) }
            "Unreachable" { [System.Drawing.Color]::Orange }
            "Starting"    { [System.Drawing.Color]::Gold }
            default       { [System.Drawing.Color]::LightGray }
        }
    }
    if ($script:UiPid) {
        $script:UiPid.Text = if ($Snapshot.Pid -gt 0) { "PID $($Snapshot.Pid)" } else { "PID -" }
    }
    if ($script:UiVersion) {
        $parts = @()
        if ($Snapshot.AppVersion) { $parts += $Snapshot.AppVersion }
        if ($Snapshot.NodeVersion) { $parts += "Node $($Snapshot.NodeVersion)" }
        $mode = Get-OvaBuyServerMode -Paths $script:Paths
        $parts += "mode: $mode"
        $parts += "DB: $(if ($Snapshot.HasDatabase) { 'yes' } else { 'no' })"
        $script:UiVersion.Text = ($parts -join " | ")
    }
    if ($script:UiHealthBar) {
        if ($Snapshot.Pid -le 0) {
            $script:UiHealthBar.Text = "Health: n/a (stopped)"
        }
        elseif ($Snapshot.HealthOk) {
            $ver = if ($Snapshot.AppVersion) { " | $($Snapshot.AppVersion)" } else { "" }
            $script:UiHealthBar.Text = "Health: OK $($Snapshot.HealthMs)ms$ver | $($script:Paths.HealthUrl)"
        }
        else {
            $script:UiHealthBar.Text = "Health: fail $($Snapshot.HealthError)"
        }
    }
    if ($script:UiLastChange) {
        $script:UiLastChange.Text = "Last check: $($Snapshot.CheckedAt.ToString('HH:mm:ss'))"
    }

    if ($script:LastSnapshotStatus -ne $Snapshot.Status) {
        if ($null -ne $script:LastSnapshotStatus) {
            Write-OvaBuyLog "Status changed: $script:LastSnapshotStatus -> $($Snapshot.Status)" -Level STEP
            $script:UiLastChange.Text = "Status change: $(Get-Date -Format 'HH:mm:ss')"
        }
        $script:LastSnapshotStatus = $Snapshot.Status
    }
}

function Poll-OvaBuyStatus {
    $snap = Get-OvaBuyRuntimeSnapshot -RepoRoot $script:RepoRoot -Url $script:Paths.Url -Port $script:Paths.Port -HealthUrl $script:Paths.HealthUrl
    Update-StatusUi -Snapshot $snap
    return $snap
}

function Drain-OvaBuyFollowLogs {
    $tail = Get-OvaBuyFileTail -Path $script:Paths.DevServerLog -AfterOffset $script:DevLogOffset
    $script:DevLogOffset = $tail.NewOffset
    if (-not $script:FollowLogs) { return }
    foreach ($line in $tail.Lines) {
        [void]$script:PendingEventLines.Enqueue("[dev] $line")
    }
}

function Invoke-LaunchControlAction {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [string]$BusyText = "Working..."
    )
    if ($script:LaunchControlBusy) { return }
    Set-LaunchControlBusy -Busy $true
    try {
        & $Action
    }
    catch {
        Write-OvaBuyLog $_.Exception.Message -Level ERROR
        [System.Windows.Forms.MessageBox]::Show(
            "An error occurred:`r`n$($_.Exception.Message)`r`n`r`nLog: $($script:LogPath)",
            "OvaBuy Launch Control", "OK", "Error") | Out-Null
    }
    finally {
        Set-LaunchControlBusy -Busy $false
        Poll-OvaBuyStatus | Out-Null
    }
}

function Invoke-LaunchControlModeAction {
    param([string]$ModeName)
    switch ($ModeName) {
        "Start"    { Start-OvaBuyDevServer }
        "Stop"     { Stop-OvaBuyDevServer }
        "Restart"  { Stop-OvaBuyDevServer; Start-Sleep -Seconds 1; Start-OvaBuyDevServer }
        "Setup"    { Start-OvaBuySetup }
        "Open"     { Open-OvaBuyBrowser }
        "OpenLogs" { Open-OvaBuyLogsFolder }
        "Status"   { Poll-OvaBuyStatus | Out-Null }
        "Redeploy" { Start-OvaBuyRedeploy }
        default    { throw "Unknown Mode: $ModeName" }
    }
}

function Show-OvaBuyLaunchControl {
    Initialize-OvaBuyWinForms
    Initialize-OvaBuyLogging | Out-Null
    Write-OvaBuyLog "OvaBuy Launch Control opened" -Level STEP

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "OvaBuy Launch Control"
    $form.Width = 1040
    $form.Height = 760
    $form.StartPosition = "CenterScreen"
    $form.MinimumSize = New-Object System.Drawing.Size(900, 640)
    $form.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 36)

    $left = New-Object System.Windows.Forms.Panel
    $left.Left = 12
    $left.Top = 12
    $left.Width = 280
    $left.Height = 700
    $left.Anchor = "Top, Bottom, Left"
    $left.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 48)
  $left.AutoScroll = $true
    [void]$form.Controls.Add($left)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "OvaBuy"
    $title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 16)
    $title.ForeColor = [System.Drawing.Color]::FromArgb(165, 180, 252)
    $title.Left = 12
    $title.Top = 12
    $title.Width = 250
    $title.Height = 32
    [void]$left.Controls.Add($title)

    $tagline = New-Object System.Windows.Forms.Label
    $tagline.Text = "APAC hardware ordering"
    $tagline.ForeColor = [System.Drawing.Color]::Gray
    $tagline.Left = 12
    $tagline.Top = 44
    $tagline.Width = 250
    $tagline.Height = 18
    [void]$left.Controls.Add($tagline)

    $script:UiStatusBig = New-Object System.Windows.Forms.Label
    $script:UiStatusBig.Text = "Unknown"
    $script:UiStatusBig.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 20)
    $script:UiStatusBig.ForeColor = [System.Drawing.Color]::LightGray
    $script:UiStatusBig.Left = 12
    $script:UiStatusBig.Top = 72
    $script:UiStatusBig.Width = 250
    $script:UiStatusBig.Height = 40
    [void]$left.Controls.Add($script:UiStatusBig)

    $script:UiPid = New-Object System.Windows.Forms.Label
    $script:UiPid.Text = "PID -"
    $script:UiPid.ForeColor = [System.Drawing.Color]::Silver
    $script:UiPid.Left = 12
    $script:UiPid.Top = 116
    $script:UiPid.Width = 250
    [void]$left.Controls.Add($script:UiPid)

    $script:UiVersion = New-Object System.Windows.Forms.Label
    $script:UiVersion.Text = "-"
    $script:UiVersion.ForeColor = [System.Drawing.Color]::Silver
    $script:UiVersion.Left = 12
    $script:UiVersion.Top = 136
    $script:UiVersion.Width = 250
    $script:UiVersion.Height = 48
    [void]$left.Controls.Add($script:UiVersion)

    $script:UiLastChange = New-Object System.Windows.Forms.Label
    $script:UiLastChange.Text = "Last check: -"
    $script:UiLastChange.ForeColor = [System.Drawing.Color]::DimGray
    $script:UiLastChange.Left = 12
    $script:UiLastChange.Top = 188
    $script:UiLastChange.Width = 250
    [void]$left.Controls.Add($script:UiLastChange)

    $note = New-Object System.Windows.Forms.Label
    $note.Text = "After git sync use Redeploy (preserves .env)."
    $note.ForeColor = [System.Drawing.Color]::DarkGoldenrod
    $note.Left = 12
    $note.Top = 212
    $note.Width = 250
    $note.Height = 32
    [void]$left.Controls.Add($note)

    $y = 252
    function Add-LcButton([string]$text, [scriptblock]$onClick) {
        $b = New-Object System.Windows.Forms.Button
        $b.Text = $text
        $b.Left = 12
        $b.Top = $y
        $b.Width = 256
        $b.Height = 32
        $b.FlatStyle = "Flat"
        $b.BackColor = [System.Drawing.Color]::FromArgb(55, 55, 65)
        $b.ForeColor = [System.Drawing.Color]::White
        $b.Add_Click($onClick)
        [void]$left.Controls.Add($b)
        [void]$script:ActionButtons.Add($b)
        $y += 38
        return $b
    }

    [void](Add-LcButton "Start service" { Invoke-LaunchControlAction { Start-OvaBuyDevServer } })
    [void](Add-LcButton "Stop service" { Invoke-LaunchControlAction { Stop-OvaBuyDevServer } })
    [void](Add-LcButton "Restart service" { Invoke-LaunchControlAction { Stop-OvaBuyDevServer; Start-Sleep -Seconds 1; Start-OvaBuyDevServer } })
    [void](Add-LcButton "Refresh status" { Poll-OvaBuyStatus | Out-Null })
    [void](Add-LcButton "Redeploy (preserve config)" { Invoke-LaunchControlAction { Start-OvaBuyRedeploy } })
    [void](Add-LcButton "Setup (install + DB)" { Invoke-LaunchControlAction { Start-OvaBuySetup } })
    [void](Add-LcButton "Open in browser" { Open-OvaBuyBrowser })
    [void](Add-LcButton "Open logs folder" { Open-OvaBuyLogsFolder })

    $btnFollow = Add-LcButton "Follow logs: OFF" {
        $script:FollowLogs = -not $script:FollowLogs
        $script:btnFollowRef.Text = if ($script:FollowLogs) { "Follow logs: ON" } else { "Follow logs: OFF" }
        Write-OvaBuyLog "Follow logs: $(if ($script:FollowLogs) { 'ON' } else { 'OFF' })"
    }
    $script:btnFollowRef = $btnFollow

    $btnDiag = Add-LcButton "Diagnostics logging: OFF" {
        $on = -not (Test-DiagnosticsEnabled)
        Set-DiagnosticsEnabled -Enabled $on
        $script:btnDiagRef.Text = if ($on) { "Diagnostics logging: ON" } else { "Diagnostics logging: OFF" }
    }
    $script:btnDiagRef = $btnDiag
    if (Test-DiagnosticsEnabled) { $btnDiag.Text = "Diagnostics logging: ON" }

    $right = New-Object System.Windows.Forms.Panel
    $right.Left = 300
    $right.Top = 12
    $right.Width = 720
    $right.Height = 700
    $right.Anchor = "Top, Bottom, Left, Right"
    [void]$form.Controls.Add($right)

    $script:UiHealthBar = New-Object System.Windows.Forms.Label
    $script:UiHealthBar.Text = "Health: n/a"
    $script:UiHealthBar.BackColor = [System.Drawing.Color]::FromArgb(25, 25, 30)
    $script:UiHealthBar.ForeColor = [System.Drawing.Color]::Gainsboro
    $script:UiHealthBar.Left = 0
    $script:UiHealthBar.Top = 0
    $script:UiHealthBar.Width = 720
    $script:UiHealthBar.Height = 28
    $script:UiHealthBar.TextAlign = "MiddleLeft"
    $script:UiHealthBar.Padding = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
    $script:UiHealthBar.Anchor = "Top, Left, Right"
    [void]$right.Controls.Add($script:UiHealthBar)

    $eventsCaption = New-Object System.Windows.Forms.Label
    $eventsCaption.Text = "Events (status changes + WARN/ERROR; Follow logs for server tail)"
    $eventsCaption.ForeColor = [System.Drawing.Color]::Gray
    $eventsCaption.Left = 0
    $eventsCaption.Top = 34
    $eventsCaption.Width = 720
    $eventsCaption.Height = 18
    $eventsCaption.Anchor = "Top, Left, Right"
    [void]$right.Controls.Add($eventsCaption)

    $script:UiLogBox = New-Object System.Windows.Forms.RichTextBox
    $script:UiLogBox.Left = 0
    $script:UiLogBox.Top = 56
    $script:UiLogBox.Width = 720
    $script:UiLogBox.Height = 640
    $script:UiLogBox.Anchor = "Top, Bottom, Left, Right"
    $script:UiLogBox.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 22)
    $script:UiLogBox.ForeColor = [System.Drawing.Color]::Gainsboro
    $script:UiLogBox.ReadOnly = $true
    $script:UiLogBox.BorderStyle = "None"
    $script:UiLogBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    [void]$right.Controls.Add($script:UiLogBox)

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 250
    $timer.Add_Tick({
        $line = $null
        while ($script:PendingEventLines.TryDequeue([ref]$line)) {
            if ($line) {
                $script:UiLogBox.AppendText("$line`r`n")
                if ($script:UiLogBox.TextLength -gt $script:MaxEventChars) {
                    $script:UiLogBox.Text = $script:UiLogBox.Text.Substring($script:UiLogBox.Text.Length - $script:MaxEventChars)
                }
                $script:UiLogBox.ScrollToCaret()
            }
            $line = $null
        }
        Drain-OvaBuyFollowLogs
        $now = [DateTime]::UtcNow
        if (($now - $script:LastStatusPollUtc).TotalMilliseconds -ge $script:StatusPollIntervalMs) {
            $script:LastStatusPollUtc = $now
            Poll-OvaBuyStatus | Out-Null
        }
    })
    $timer.Start()

    $form.Add_FormClosing({
        Write-OvaBuyLog "Launch Control closing (service left running)" -Level INFO
    })

    Poll-OvaBuyStatus | Out-Null
    Write-OvaBuyLog "Logs: $script:LogRoot" -Level INFO
    Write-OvaBuyLog "Demo login: cs.singapore@demo.local / demo123" -Level INFO
    [void]$form.ShowDialog()
}

try {
    if ($ActionOnly -and $Mode -ne "Menu") {
        Initialize-OvaBuyLogging | Out-Null
        Write-OvaBuyLog "ActionOnly mode: $Mode" -Level STEP
        Invoke-LaunchControlModeAction -ModeName $Mode
        Write-OvaBuyLog "ActionOnly finished: $Mode" -Level OK
        exit 0
    }
    Show-OvaBuyLaunchControl
}
catch {
    $msg = $_.Exception.Message
    if ($script:LogPath) {
        Add-Content -LiteralPath $script:LogPath -Value "[ERROR] $msg" -Encoding UTF8
    }
    if ($script:WinFormsReady) {
        [System.Windows.Forms.MessageBox]::Show(
            "OvaBuy Launch Control crashed:`r`n$msg`r`n`r`nLog: $($script:LogPath)",
            "OvaBuy Launch Control", "OK", "Error") | Out-Null
    }
    else {
        Write-Error $msg
    }
    exit 1
}
