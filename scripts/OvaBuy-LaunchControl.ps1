#Requires -Version 5.1
<#
.SYNOPSIS
  OvaBuy Launch Control - service start/stop, redeploy, logs, and status for the APAC ordering PoC.

.DESCRIPTION
  WinForms ops UI. Logs under <repo>\logs\.
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
$script:ActionButtons = New-Object System.Collections.ArrayList
$script:WinFormsReady = $false
$script:MainForm = $null
$script:StatusPollInFlight = $false
$script:PendingWork = $null

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
    if ($script:WinFormsReady -and $script:UiLogBox -and -not $script:UiLogBox.IsDisposed) {
        # Flush important lines immediately so Start/Stop don't look like no-ops.
        $flush = $null
        while ($script:PendingEventLines.TryDequeue([ref]$flush)) {
            if ($flush) {
                $script:UiLogBox.AppendText("$flush`r`n")
                $script:UiLogBox.ScrollToCaret()
            }
            $flush = $null
        }
        [System.Windows.Forms.Application]::DoEvents()
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
    while (-not $p.HasExited) {
        if ($script:WinFormsReady) { [System.Windows.Forms.Application]::DoEvents() }
        Start-Sleep -Milliseconds 150
    }
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
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
    $listenPid = Test-OvaBuyPortListening -Port $script:Paths.Port
    if ($listenPid -gt 0) {
        Write-OvaBuyLog "App already listening on port $($script:Paths.Port) (PID $listenPid)" -Level WARN
        Save-OvaBuyServerPid -Paths $script:Paths -ProcessId $listenPid -Mode $ServerMode
        return
    }

    if (-not (Test-Path (Join-Path $script:RepoRoot "package.json"))) {
        throw "package.json not found in $($script:RepoRoot)"
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js not found. Install Node 20+ from https://nodejs.org/"
    }
    if (-not (Test-Path (Join-Path $script:RepoRoot "node_modules"))) {
        Write-OvaBuyLog "Dependencies missing - running setup first" -Level STEP
        Start-OvaBuySetup
    }
    elseif (-not (Test-Path $script:Paths.Database)) {
        Invoke-NpmLogged -Arguments "run db:deploy" -StepLabel "Database migrate"
        Invoke-NpmLogged -Arguments "run db:seed" -StepLabel "Seed demo data"
    }

    if ($ServerMode -eq "prod" -and -not (Test-Path (Join-Path $script:RepoRoot ".next"))) {
        Write-OvaBuyLog "No production build (.next) - falling back to npm run dev" -Level WARN
        $ServerMode = "dev"
    }

    Ensure-OvaBuyEnvFile -Paths $script:Paths | Out-Null
    if (-not (Test-Path -LiteralPath $script:LogRoot)) {
        New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null
    }

    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = "npm.cmd" }
    $npmArgs = if ($ServerMode -eq "prod") { "run start" } else { "run dev" }
    $devLog = $script:Paths.DevServerLog
    $errLog = Join-Path $script:LogRoot "dev-server.err.log"

    # Detached Start-Process so the app keeps running after ActionOnly / LC exit.
    # File redirects avoid needing a log-pump thread in this process.
    Write-OvaBuyLog "Starting app: npm $npmArgs (mode=$ServerMode)" -Level STEP
    $p = Start-Process -FileName $npm -ArgumentList $npmArgs `
        -WorkingDirectory $script:RepoRoot `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $devLog `
        -RedirectStandardError $errLog
    if (-not $p) {
        throw "Failed to start npm $npmArgs"
    }

    $script:DevServerProcess = $p
    Save-OvaBuyServerPid -Paths $script:Paths -ProcessId $p.Id -Mode $ServerMode
    Write-OvaBuyLog "App process started (npm PID $($p.Id)) on $($script:Paths.Url)" -Level OK
    Write-OvaBuyLog "App log: $devLog"

    # Brief wait so status can move past Stopped without freezing long.
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        if ((Test-OvaBuyPortListening -Port $script:Paths.Port) -gt 0) {
            Write-OvaBuyLog "Port $($script:Paths.Port) is listening - app is starting up" -Level OK
            return
        }
        if ($p.HasExited) {
            $tail = ""
            if (Test-Path -LiteralPath $errLog) {
                $tail = (Get-Content -LiteralPath $errLog -Tail 8 -ErrorAction SilentlyContinue) -join "`n"
            }
            throw "App process exited immediately (exit $($p.ExitCode)). $tail"
        }
        Start-Sleep -Milliseconds 400
    }
    Write-OvaBuyLog "App launched; waiting for Next.js to become healthy (can take 30-60s)" -Level INFO
}

function Start-OvaBuyDevServer {
    # Default Start = day-to-day app run (dev). Redeploy switches mode to prod.
    $mode = Get-OvaBuyServerMode -Paths $script:Paths
    if ($mode -ne "prod") { $mode = "dev" }
    Start-OvaBuyServerProcess -ServerMode $mode
}

function Stop-OvaBuyDevServer {
    Write-OvaBuyLog "Stopping app on port $($script:Paths.Port)" -Level STEP
    $stop = Stop-OvaBuyServer -Port $script:Paths.Port

    $trackedPid = 0
    if (Test-Path -LiteralPath $script:Paths.PidFile) {
        [void][int]::TryParse((Get-Content -LiteralPath $script:Paths.PidFile -Raw).Trim(), [ref]$trackedPid)
    }
    if ($trackedPid -gt 0 -and $stop.Killed -notcontains $trackedPid -and $stop.Found -notcontains $trackedPid) {
        $out = & taskkill.exe /PID $trackedPid /T /F 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) {
            $stop.Killed += $trackedPid
        }
        else {
            $stop.Failed += @{ Pid = $trackedPid; Detail = $out.Trim() }
        }
    }
    if ($script:DevServerProcess -and -not $script:DevServerProcess.HasExited) {
        try { $script:DevServerProcess.Kill($true) } catch { }
    }
    $script:DevServerProcess = $null
    Clear-OvaBuyServerPid -Paths $script:Paths

    if ($stop.Killed.Count -gt 0) {
        Write-OvaBuyLog "Stopped app process(es): $($stop.Killed -join ', ')" -Level OK
    }
    elseif ($stop.Failed.Count -gt 0) {
        foreach ($f in $stop.Failed) {
            Write-OvaBuyLog "Could not stop PID $($f.Pid): $($f.Detail)" -Level ERROR
        }
        throw "Stop failed - process may be owned by another Windows account. Re-run Launch Control as that account, or end the process in Task Manager."
    }
    elseif ($stop.Found.Count -eq 0) {
        Write-OvaBuyLog "App was not running (no listener on port $($script:Paths.Port))" -Level INFO
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

function Request-OvaBuyStatusPoll {
    param([switch]$Force)
    if ($script:StatusPollInFlight) { return }
    $now = [DateTime]::UtcNow
    if (-not $Force -and (($now - $script:LastStatusPollUtc).TotalMilliseconds -lt $script:StatusPollIntervalMs)) {
        return
    }
    $script:StatusPollInFlight = $true
    $script:LastStatusPollUtc = $now

    $bw = New-Object System.ComponentModel.BackgroundWorker
    $bw.Add_DoWork({
        param($sender, $e)
        $e.Result = Get-OvaBuyRuntimeSnapshot `
            -RepoRoot $script:RepoRoot `
            -Url $script:Paths.Url `
            -Port $script:Paths.Port `
            -HealthUrl $script:Paths.HealthUrl
    })
    $bw.Add_RunWorkerCompleted({
        param($sender, $e)
        $script:StatusPollInFlight = $false
        if ($e.Error) { return }
        Update-StatusUi -Snapshot $e.Result
    })
    $bw.RunWorkerAsync() | Out-Null
}

function Poll-OvaBuyStatus {
    param([switch]$Sync)
    if ($Sync -or -not $script:MainForm) {
        $snap = Get-OvaBuyRuntimeSnapshot `
            -RepoRoot $script:RepoRoot `
            -Url $script:Paths.Url `
            -Port $script:Paths.Port `
            -HealthUrl $script:Paths.HealthUrl
        Update-StatusUi -Snapshot $snap
        return $snap
    }
    Request-OvaBuyStatusPoll -Force
    return $script:LatestSnapshot
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
    if ($script:LaunchControlBusy) {
        Write-OvaBuyLog "Busy - wait for the current action to finish" -Level WARN
        return
    }
    Set-LaunchControlBusy -Busy $true
    try {
        # Run on the UI thread. Start/Stop use Start-Process and return quickly;
        # Setup/Redeploy can take longer but report progress via Write-OvaBuyLog + DoEvents.
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
        Request-OvaBuyStatusPoll -Force
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
        "Status"   { Poll-OvaBuyStatus -Sync | Out-Null }
        "Redeploy" { Start-OvaBuyRedeploy }
        default    { throw "Unknown Mode: $ModeName" }
    }
}

function Show-OvaBuyLaunchControl {
    Initialize-OvaBuyWinForms
    Initialize-OvaBuyLogging | Out-Null
    Write-OvaBuyLog "OvaBuy Launch Control opened" -Level STEP

    $form = New-Object System.Windows.Forms.Form
    $script:MainForm = $form
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

    function New-LcButton {
        param(
            [System.Windows.Forms.Control]$Parent,
            [string]$Text,
            [int]$Left,
            [int]$Top,
            [int]$Width = 256,
            [int]$Height = 30,
            [scriptblock]$OnClick,
            [System.Drawing.Color]$BackColor = ([System.Drawing.Color]::FromArgb(55, 55, 65))
        )
        $b = New-Object System.Windows.Forms.Button
        $b.Text = $Text
        $b.Left = $Left
        $b.Top = $Top
        $b.Width = $Width
        $b.Height = $Height
        $b.FlatStyle = "Flat"
        $b.BackColor = $BackColor
        $b.ForeColor = [System.Drawing.Color]::White
        if ($OnClick) { $b.Add_Click($OnClick) }
        [void]$Parent.Controls.Add($b)
        [void]$script:ActionButtons.Add($b)
        return $b
    }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "OvaBuy"
    $title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 16)
    $title.ForeColor = [System.Drawing.Color]::FromArgb(165, 180, 252)
    $title.Left = 12
    $title.Top = 8
    $title.Width = 250
    $title.Height = 28
    [void]$left.Controls.Add($title)

    $script:UiStatusBig = New-Object System.Windows.Forms.Label
    $script:UiStatusBig.Text = "Unknown"
    $script:UiStatusBig.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 18)
    $script:UiStatusBig.ForeColor = [System.Drawing.Color]::LightGray
    $script:UiStatusBig.Left = 12
    $script:UiStatusBig.Top = 36
    $script:UiStatusBig.Width = 250
    $script:UiStatusBig.Height = 32
    [void]$left.Controls.Add($script:UiStatusBig)

    $script:UiPid = New-Object System.Windows.Forms.Label
    $script:UiPid.Text = "PID -"
    $script:UiPid.ForeColor = [System.Drawing.Color]::Silver
    $script:UiPid.Left = 12
    $script:UiPid.Top = 68
    $script:UiPid.Width = 250
    [void]$left.Controls.Add($script:UiPid)

    $script:UiVersion = New-Object System.Windows.Forms.Label
    $script:UiVersion.Text = "-"
    $script:UiVersion.ForeColor = [System.Drawing.Color]::Silver
    $script:UiVersion.Left = 12
    $script:UiVersion.Top = 86
    $script:UiVersion.Width = 250
    $script:UiVersion.Height = 40
    [void]$left.Controls.Add($script:UiVersion)

    $script:UiLastChange = New-Object System.Windows.Forms.Label
    $script:UiLastChange.Text = "Last check: -"
    $script:UiLastChange.ForeColor = [System.Drawing.Color]::DimGray
    $script:UiLastChange.Left = 12
    $script:UiLastChange.Top = 128
    $script:UiLastChange.Width = 250
    [void]$left.Controls.Add($script:UiLastChange)

    $svcGroup = New-Object System.Windows.Forms.GroupBox
    $svcGroup.Text = "App (npm run dev / start)"
    $svcGroup.Left = 8
    $svcGroup.Top = 152
    $svcGroup.Width = 264
    $svcGroup.Height = 72
    $svcGroup.ForeColor = [System.Drawing.Color]::Gainsboro
    [void]$left.Controls.Add($svcGroup)

    $svcW = 80
    $svcGap = 4
    [void](New-LcButton -Parent $svcGroup -Text "Start" -Left 8 -Top 20 -Width $svcW -Height 28 -OnClick {
        $script:FollowLogs = $true
        if ($script:btnFollowRef) { $script:btnFollowRef.Text = "Follow logs: ON" }
        Invoke-LaunchControlAction { Start-OvaBuyDevServer }
    })
    [void](New-LcButton -Parent $svcGroup -Text "Stop" -Left (8 + $svcW + $svcGap) -Top 20 -Width $svcW -Height 28 -OnClick {
        Invoke-LaunchControlAction { Stop-OvaBuyDevServer }
    })
    [void](New-LcButton -Parent $svcGroup -Text "Restart" -Left (8 + 2 * ($svcW + $svcGap)) -Top 20 -Width $svcW -Height 28 -OnClick {
        Invoke-LaunchControlAction {
            Stop-OvaBuyDevServer
            Start-Sleep -Seconds 1
            Start-OvaBuyDevServer
        }
    })

    $deployGroup = New-Object System.Windows.Forms.GroupBox
    $deployGroup.Text = "After git sync"
    $deployGroup.Left = 8
    $deployGroup.Top = 232
    $deployGroup.Width = 264
    $deployGroup.Height = 56
    $deployGroup.ForeColor = [System.Drawing.Color]::Gainsboro
    [void]$left.Controls.Add($deployGroup)

    [void](New-LcButton -Parent $deployGroup -Text "Redeploy (preserve .env)" -Left 8 -Top 20 -Width 248 -Height 28 `
        -BackColor ([System.Drawing.Color]::FromArgb(46, 109, 164)) -OnClick {
        Invoke-LaunchControlAction { Start-OvaBuyRedeploy }
    })

    $opsGroup = New-Object System.Windows.Forms.GroupBox
    $opsGroup.Text = "Operations"
    $opsGroup.Left = 8
    $opsGroup.Top = 296
    $opsGroup.Width = 264
    $opsGroup.Height = 112
    $opsGroup.ForeColor = [System.Drawing.Color]::Gainsboro
    [void]$left.Controls.Add($opsGroup)

    $halfW = 120
    [void](New-LcButton -Parent $opsGroup -Text "Refresh" -Left 8 -Top 20 -Width $halfW -Height 28 -OnClick {
        Request-OvaBuyStatusPoll -Force
    })
    [void](New-LcButton -Parent $opsGroup -Text "Setup" -Left (8 + $halfW + 8) -Top 20 -Width $halfW -Height 28 -OnClick {
        Invoke-LaunchControlAction { Start-OvaBuySetup }
    })
    [void](New-LcButton -Parent $opsGroup -Text "Open browser" -Left 8 -Top 54 -Width $halfW -Height 28 -OnClick {
        Open-OvaBuyBrowser
    })
    [void](New-LcButton -Parent $opsGroup -Text "Open logs" -Left (8 + $halfW + 8) -Top 54 -Width $halfW -Height 28 -OnClick {
        Open-OvaBuyLogsFolder
    })

    $logGroup = New-Object System.Windows.Forms.GroupBox
    $logGroup.Text = "Logging"
    $logGroup.Left = 8
    $logGroup.Top = 416
    $logGroup.Width = 264
    $logGroup.Height = 88
    $logGroup.ForeColor = [System.Drawing.Color]::Gainsboro
    [void]$left.Controls.Add($logGroup)

    $script:btnFollowRef = New-LcButton -Parent $logGroup -Text "Follow logs: OFF" -Left 8 -Top 20 -Width 248 -Height 28 -OnClick {
        $script:FollowLogs = -not $script:FollowLogs
        $script:btnFollowRef.Text = if ($script:FollowLogs) { "Follow logs: ON" } else { "Follow logs: OFF" }
        Write-OvaBuyLog "Follow logs: $(if ($script:FollowLogs) { 'ON' } else { 'OFF' })"
    }
    $script:btnDiagRef = New-LcButton -Parent $logGroup -Text "Diagnostics logging: OFF" -Left 8 -Top 52 -Width 248 -Height 28 -OnClick {
        $on = -not (Test-DiagnosticsEnabled)
        Set-DiagnosticsEnabled -Enabled $on
        $script:btnDiagRef.Text = if ($on) { "Diagnostics logging: ON" } else { "Diagnostics logging: OFF" }
    }
    if (Test-DiagnosticsEnabled) { $script:btnDiagRef.Text = "Diagnostics logging: ON" }

    $left.AutoScrollMinSize = New-Object System.Drawing.Size(0, 520)

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
        Request-OvaBuyStatusPoll
    })
    $timer.Start()

    $form.Add_FormClosing({
        Write-OvaBuyLog "Launch Control closing (service left running)" -Level INFO
    })

    Request-OvaBuyStatusPoll -Force
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
