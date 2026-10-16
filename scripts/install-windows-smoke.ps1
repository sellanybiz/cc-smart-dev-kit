# install.ps1 in a fake world, on a real Windows machine: the proof the Windows CI job runs
# (the way scripts/windows-hook-smoke.sh proves the hooks there). `bash scripts/…` cannot be
# used for the PowerShell installer, and PowerShell is what a Windows person runs it with:
# pwsh starts install.ps1 as its own process, with a temp HOME, fakes for the four programs
# it calls, and a file whose lines are the answers.
#
# The cases are the ones the Linux and macOS test (scripts/install.test.ts) proves for
# install.sh: a fresh machine, an old-anymodel machine, a second run, inside a Claude Code
# session, an old Bun with a no, no repository argument, -DryRun, and what only the person
# has. One case is not here: the browser's token, which the plugin's own command reads from
# the console — a fake cannot consume that, so the Linux test proves it (its fd is a file).
#
# Nothing here reaches the network, a real Claude Code, or the person's own profile: the
# fakes answer every call, and the world is a temp folder under $env:TEMP.
param()

$ErrorActionPreference = "Stop"
# A native command's stderr (install.ps1 writes its failures there) is output here, not an
# error to stop on: PowerShell 7 only does that when this is on, and the default is off.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Stop-Smoke([string]$Message) {
  [Console]::Error.WriteLine("windows-install-smoke: $Message")
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$install = Join-Path $root "install.ps1"
if (-not (Test-Path $install)) { Stop-Smoke "install.ps1 is not at the repo root" }
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrEmpty($pwsh)) { Stop-Smoke "pwsh is not on PATH" }
$repo = "example-org/cc-smart-dev-kit"
$marketplaceVersion = "0.4.2"

# The minimum Bun the script checks, read from the script itself: this test never keeps a
# second copy of that number (src/build-info/bun.ts is its one home, and
# scripts/install.test.ts keeps the two installers equal to it).
$minBun = [regex]::Match((Get-Content -Raw $install), '(?m)^\$MinBun = "([^"]+)"').Groups[1].Value
if ([string]::IsNullOrEmpty($minBun)) { Stop-Smoke "install.ps1 has no `$MinBun line" }

# ─── the fakes ─────────────────────────────────────────────────────────────────────────
# One .ps1 per program with a .cmd trampoline beside it: PowerShell's Get-Command finds the
# .cmd, and the logic stays readable PowerShell. Each logs its arguments, and the ones the
# plugin reads a secret from read their stdin (and log only its shape).
function Write-Fakes([string]$Dir, [string]$Log) {
  $bun = @'
$log = $env:FAKE_LOG
Add-Content -Path $log -Value ("bun " + ($args -join " "))
$joined = $args -join " "
if ($args[0] -eq "--version") {
  if (Test-Path $env:FAKE_BUN_UPGRADED) { Get-Content $env:FAKE_BUN_UPGRADED } else { Write-Output $env:FAKE_BUN_VERSION }
  exit 0
}
if ($args[0] -eq "upgrade") { Set-Content -Path $env:FAKE_BUN_UPGRADED -Value $env:FAKE_BUN_UPGRADE_TO; exit 0 }
try { $null = [Console]::In } catch { }
if ($joined -like "*browser token*") {
  $line = ""
  try { $line = [Console]::In.ReadLine() } catch { }
  if ($null -eq $line) { $line = "" }
  Add-Content -Path $log -Value ("stdin-" + $line.Length + "-chars")
}
if ($joined -like "*--backend-key-stdin*" -or $joined -like "*--tavily-key-stdin*") {
  $all = ""
  try { $all = [Console]::In.ReadToEnd() } catch { }
  if ($null -eq $all) { $all = "" }
  if ($all.Trim().Length -gt 0) { Add-Content -Path $log -Value "stdin-nonempty" } else { Add-Content -Path $log -Value "stdin-empty" }
}
if ($joined -like "*dist/cli.js setup*") {
  $bin = Join-Path $env:HOME ".local\bin"
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  Set-Content -Path (Join-Path $bin "cc-smart-dev-kit.cmd") -Value ("@echo off`r`necho launcher %*>> `"" + $env:FAKE_LOG + "`"`r`nexit /b 0`r`n")
}
exit 0
'@

  $claude = @'
$log = $env:FAKE_LOG
Add-Content -Path $log -Value ("claude " + ($args -join " "))
if ($args[0] -eq "plugin" -and $args[1] -eq "marketplace" -and $args[2] -eq "add") {
  $name = "cc-smart-dev-kit"
  if ($args[3] -like "*claude-mem*") { $name = "thedotmack" }
  if ($args[3] -like "*claude-plugins-official*") { $name = "claude-plugins-official" }
  $dir = Join-Path $env:CLAUDE_CONFIG_DIR ("plugins\marketplaces\" + $name)
  New-Item -ItemType Directory -Force -Path (Join-Path $dir "plugin\.claude-plugin") | Out-Null
  if ($args[3] -like "*cc-smart-dev-kit*") {
    Set-Content -Path (Join-Path $dir "plugin\.claude-plugin\plugin.json") -Value ('{"name":"cc-smart-dev-kit","version":"' + $env:FAKE_MARKETPLACE_VERSION + '"}')
  }
  $file = Join-Path $env:CLAUDE_CONFIG_DIR "plugins\known_marketplaces.json"
  $data = @{}
  if (Test-Path $file) { foreach ($p in (Get-Content -Raw $file | ConvertFrom-Json).PSObject.Properties) { $data[$p.Name] = $p.Value } }
  $data[$name] = @{ source = @{ source = "github"; repo = $args[3] }; installLocation = $dir }
  $data | ConvertTo-Json -Depth 6 | Set-Content -Path $file
}
if ($args[0] -eq "plugin" -and $args[1] -eq "install") {
  $dir = Join-Path $env:CLAUDE_CONFIG_DIR ("plugins\cache\cc-smart-dev-kit\cc-smart-dev-kit\" + $env:FAKE_MARKETPLACE_VERSION)
  New-Item -ItemType Directory -Force -Path (Join-Path $dir "dist") | Out-Null
  Set-Content -Path (Join-Path $dir "dist\cli.js") -Value 'await import("the plugin");'
  Set-Content -Path (Join-Path $dir "bunfig.toml") -Value "{}"
  $file = Join-Path $env:CLAUDE_CONFIG_DIR "plugins\installed_plugins.json"
  $data = @{ version = 2; plugins = @{} }
  if (Test-Path $file) {
    $existing = Get-Content -Raw $file | ConvertFrom-Json
    foreach ($p in $existing.plugins.PSObject.Properties) { $data.plugins[$p.Name] = $p.Value }
  }
  $data.plugins["cc-smart-dev-kit@cc-smart-dev-kit"] = @(@{ scope = "user"; installPath = $dir; version = $env:FAKE_MARKETPLACE_VERSION })
  $data | ConvertTo-Json -Depth 6 | Set-Content -Path $file
}
exit 0
'@

  $git = @'
Add-Content -Path $env:FAKE_LOG -Value ("git " + ($args -join " "))
if ($env:FAKE_GIT_FAILS -eq "yes") { exit 128 }
exit 0
'@

  $gh = @'
Add-Content -Path $env:FAKE_LOG -Value ("gh " + ($args -join " "))
exit 0
'@

  foreach ($pair in @(@("bun", $bun), @("claude", $claude), @("git", $git), @("gh", $gh))) {
    Set-Content -Path (Join-Path $Dir ($pair[0] + ".ps1")) -Value $pair[1]
    Set-Content -Path (Join-Path $Dir ($pair[0] + ".cmd")) -Value ("@powershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0" + $pair[0] + ".ps1`" %*`r`nexit /b %errorlevel%`r`n")
  }
}

# ─── one world ──────────────────────────────────────────────────────────────────────────
function New-World([string]$Name, [hashtable]$Options = @{}) {
  $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("cc-smart-dev-kit-install-" + $Name + "-" + [Guid]::NewGuid().ToString("N"))
  $home = Join-Path $dir "home"
  $bin = Join-Path $home "bin"
  $log = Join-Path $home "calls.log"
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  Set-Content -Path $log -Value ""
  Write-Fakes -Dir $bin -Log $log
  if ($Options["NoBun"] -eq $true) {
    Remove-Item -Path (Join-Path $bin "bun.cmd"), (Join-Path $bin "bun.ps1") -Force
  }
  $answers = Join-Path $home "answers"
  $answerLines = @()
  if ($Options.ContainsKey("Answers")) { $answerLines = $Options["Answers"] }
  Set-Content -Path $answers -Value ($answerLines -join "`r`n")
  return @{
    dir = $dir; home = $home; bin = $bin; log = $log; answers = $answers
    env = @{
      HOME = $home
      CLAUDE_CONFIG_DIR = Join-Path $home ".claude"
      PATH = $bin + ";" + $env:PATH
      CC_SMART_DEV_KIT_INSTALL_TTY = $answers
      FAKE_LOG = $log
      FAKE_BUN_VERSION = $(if ($Options.ContainsKey("BunVersion")) { $Options["BunVersion"] } else { $minBun })
      FAKE_BUN_UPGRADED = Join-Path $home "bun-upgraded"
      FAKE_BUN_UPGRADE_TO = $minBun
      FAKE_MARKETPLACE_VERSION = $marketplaceVersion
      FAKE_GIT_FAILS = $(if ($Options.ContainsKey("GitFails")) { $Options["GitFails"] } else { "no" })
    }
  }
}

function Invoke-Install($World, [string[]]$Arguments, [hashtable]$Extra = @{}) {
  $applied = @{}
  foreach ($key in $World.env.Keys) {
    $applied[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$World.env[$key], "Process")
  }
  $applied["CLAUDECODE"] = [Environment]::GetEnvironmentVariable("CLAUDECODE", "Process")
  [Environment]::SetEnvironmentVariable("CLAUDECODE", $null, "Process")
  foreach ($key in $Extra.Keys) {
    $applied[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$Extra[$key], "Process")
  }
  try {
    $out = & $pwsh -NoProfile -File $install @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    foreach ($key in $applied.Keys) { [Environment]::SetEnvironmentVariable($key, $applied[$key], "Process") }
  }
  return @{ code = $code; out = $out }
}

function Get-Calls($World) {
  return @(Get-Content -Path $World.log | Where-Object { $_ -ne "" })
}

function Assert-Contains([string]$What, [string]$Text, [string]$Expected) {
  if (-not $Text.Contains($Expected)) {
    Stop-Smoke "$What`: expected to find `"$Expected`" in:`n$Text"
  }
}

function Assert-Code([string]$What, $Result, [int]$Expected) {
  if ($Result.code -ne $Expected) {
    Stop-Smoke "$What`: expected exit $Expected, got $($Result.code):`n$($Result.out)"
  }
}

$world = $null
$passed = 0
try {
  # 1. A fresh machine: the three marketplaces, the plugin, setup, doctor.
  $world = New-World "fresh" @{ Answers = @("n", "n", "n") }
  $result = Invoke-Install $world @($repo)
  Assert-Code "a fresh machine" $result 0
  Assert-Contains "a fresh machine" $result.out "✓ 1/8 not inside a Claude Code session"
  Assert-Contains "a fresh machine" $result.out "✓ 3/8 Bun $minBun is new enough (the plugin needs $minBun or newer)"
  Assert-Contains "a fresh machine" $result.out "✓ 4/8 marketplaces added: $repo, thedotmack/claude-mem, anthropics/claude-plugins-official"
  Assert-Contains "a fresh machine" $result.out "✓ 5/8 the plugin is installed ($marketplaceVersion)"
  Assert-Contains "a fresh machine" $result.out "✓ 6/8 setup finished (a new machine)"
  Assert-Contains "a fresh machine" $result.out "✓ 8/8 doctor: every check passed"
  $calls = Get-Calls $world
  $expected = @(
    "claude plugin marketplace add $repo",
    "claude plugin marketplace add thedotmack/claude-mem",
    "claude plugin marketplace add anthropics/claude-plugins-official",
    "claude plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user"
  )
  foreach ($call in $expected) {
    if ($calls -notcontains $call) { Stop-Smoke "a fresh machine: `"$call`" was not called; the log is:`n$($calls -join "`n")" }
  }
  if (-not ($calls | Where-Object { $_ -like "bun --no-env-file --config=*dist\cli.js setup" })) {
    Stop-Smoke "a fresh machine: setup was not run through the plugin's own bundle; the log is:`n$($calls -join "`n")"
  }
  if ($calls -notcontains "launcher doctor") { Stop-Smoke "a fresh machine: doctor did not run through the launcher" }
  $passed++

  # 2. A second run does only what is missing.
  $before = (Get-Calls $world).Count
  $again = Invoke-Install $world @($repo)
  Assert-Code "a second run" $again 0
  Assert-Contains "a second run" $again.out "✓ 4/8 all three marketplaces are already added"
  Assert-Contains "a second run" $again.out "✓ 5/8 the plugin is installed, at the marketplace's version ($marketplaceVersion)"
  $second = @(Get-Calls $world | Select-Object -Skip $before)
  if ($second | Where-Object { $_ -like "*marketplace add*" -or $_ -like "*plugin install*" }) {
    Stop-Smoke "a second run added a marketplace or reinstalled the plugin:`n$($second -join "`n")"
  }
  $passed++

  # 3. An old-anymodel machine: migrate, never setup.
  $old = New-World "old" @{ Answers = @("n", "n", "n") }
  New-Item -ItemType Directory -Force -Path (Join-Path $old.home ".config\anymodel") | Out-Null
  $result = Invoke-Install $old @($repo)
  Assert-Code "an old anymodel machine" $result 0
  Assert-Contains "an old anymodel machine" $result.out "✓ 6/8 migrate finished (this machine still has the old anymodel names)"
  $calls = Get-Calls $old
  if ($calls | Where-Object { $_ -like "*dist\cli.js setup" }) { Stop-Smoke "an old anymodel machine ran setup" }
  $passed++

  # 4. Inside a Claude Code session: refused, exit 2, nothing runs.
  $inside = New-World "inside" @{ Answers = @("n") }
  $result = Invoke-Install $inside @($repo) @{ CLAUDECODE = "1" }
  Assert-Code "inside a Claude Code session" $result 2
  Assert-Contains "inside a Claude Code session" $result.out "cannot run inside a Claude Code session"
  if ((Get-Calls $inside).Count -ne 0) { Stop-Smoke "inside a Claude Code session something ran: $((Get-Calls $inside) -join ", ")" }
  $passed++

  # 5. An old Bun, and the person says no: stopped, exit 2.
  $oldBun = New-World "old-bun" @{ BunVersion = "1.2.0"; Answers = @("n") }
  $result = Invoke-Install $oldBun @($repo)
  Assert-Code "an old Bun, no" $result 2
  Assert-Contains "an old Bun, no" $result.out "✗ Bun is still 1.2.0: cc-smart-dev-kit needs Bun $minBun or newer"
  if ((Get-Calls $oldBun) -contains "bun upgrade") { Stop-Smoke "an old Bun, no: bun upgrade ran anyway" }
  $passed++

  # 6. No repository argument: one usage line, exit 2.
  $empty = New-World "usage"
  $result = Invoke-Install $empty @() @{ CC_SMART_DEV_KIT_REPO = "" }
  Assert-Code "no repository argument" $result 2
  Assert-Contains "no repository argument" $result.out "usage: .\install.ps1 <owner>/<repo>"
  if ((Get-Calls $empty).Count -ne 0) { Stop-Smoke "no repository argument: something ran" }
  $passed++

  # 7. -DryRun prints the plan and changes nothing.
  $dry = New-World "dry"
  $result = Invoke-Install $dry @("-DryRun", $repo)
  Assert-Code "-DryRun" $result 0
  Assert-Contains "-DryRun" $result.out "cc-smart-dev-kit installer: dry run, the plan for this machine. Nothing is changed."
  Assert-Contains "-DryRun" $result.out "Dry run: nothing was written, nothing ran, and no network was reached."
  $calls = Get-Calls $dry
  if ($calls | Where-Object { $_ -like "claude *" -or $_ -like "git *" -or $_ -like "*dist\cli.js*" }) {
    Stop-Smoke "-DryRun ran something:`n$($calls -join "`n")"
  }
  if (Test-Path (Join-Path $dry.env.CLAUDE_CONFIG_DIR "plugins\known_marketplaces.json")) {
    Stop-Smoke "-DryRun wrote a marketplace record"
  }
  $passed++

  # 8. The two keys the person has: on stdin, never in an argument, never printed.
  $secrets = New-World "secrets" @{ Answers = @("n", "y", "omniroute-key-abc123", "y", "tvly-key-abc123") }
  $result = Invoke-Install $secrets @($repo)
  Assert-Code "the secrets" $result 0
  Assert-Contains "the secrets" $result.out "✓ 7/8 the gateway is set up"
  Assert-Contains "the secrets" $result.out "✓ 7/8 the Tavily key is saved"
  $calls = Get-Calls $secrets
  if (($calls | Where-Object { $_ -eq "stdin-nonempty" }).Count -ne 2) {
    Stop-Smoke "the secrets: a key did not reach its command on stdin:`n$($calls -join "`n")"
  }
  foreach ($secret in @("omniroute-key-abc123", "tvly-key-abc123")) {
    if (($calls -join "`n").Contains($secret)) { Stop-Smoke "a secret is in a fake's arguments: $secret" }
    if ($result.out.Contains($secret)) { Stop-Smoke "a secret was printed: $secret" }
  }
  $passed++
} finally {
  Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Filter "cc-smart-dev-kit-install-*" -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "windows-install-smoke: $passed cases passed"
exit 0
