# install.ps1 in a fake world, on a real Windows machine: the proof the Windows CI job runs
# (the way scripts/windows-hook-smoke.sh proves the hooks there). The cases are the ones
# scripts/install.test.ts proves for install.sh: a fresh machine, a second run, an
# old-anymodel machine, a half-moved machine, a machine with only the old plugin, a refusal
# inside a Claude Code session, an old Bun answered no, no repository argument, -DryRun, the
# secrets, and the exit code 3 a doctor [x] gives.
#
# The fakes are `.cmd` files and nothing else, so a fake that reads stdin (the keys, the
# browser's token) reads the very stdin the installer piped to it. They log every argument
# and answer the way the real programs do: the fake `claude` writes the same records Claude
# Code writes, the fake `bun` runs the plugin's commands as far as a fake can (the launcher,
# doctor's own [x] while the browser's token is missing), and the fake `git` and `gh` just
# log. Nothing here reaches the network, a real Claude Code, or the person's own profile:
# every world is a temp folder under $env:TEMP.
#
# Run it with `pwsh -NoProfile -File scripts/install-windows-smoke.ps1`; windows.yml runs it
# under pwsh AND under Windows PowerShell 5.1, because install.ps1 must work in both.
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
# The shell install.ps1 is started with: pwsh when this runs under pwsh, Windows PowerShell
# otherwise -- so the same file is proved in both.
$shell = (Get-Process -Id $PID).Path
if ([string]::IsNullOrEmpty($shell)) { Stop-Smoke "cannot find the PowerShell running this test" }
$repo = "example-org/cc-smart-dev-kit"
$marketplaceVersion = "0.4.2"
# The fakes are `.cmd` wrappers around the real bun.exe running this folder's JavaScript:
# found before any world prepends itself to PATH, so the wrapper never calls itself.
$script:RealBun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrEmpty($script:RealBun)) { Stop-Smoke "bun is not on PATH (the fakes run on it)" }
$script:FakesDir = Join-Path $PSScriptRoot "install-windows-fakes"
if (-not (Test-Path $script:FakesDir)) { Stop-Smoke "scripts/install-windows-fakes is not there" }

# The minimum Bun the script checks, read from the script itself: this test never keeps a
# second copy of that number (src/build-info/bun.ts is its one home, and
# scripts/install.test.ts keeps the two installers equal to it).
$minBun = [regex]::Match((Get-Content -Raw $install), '(?m)^\$MinBun = "([^"]+)"').Groups[1].Value
if ([string]::IsNullOrEmpty($minBun)) { Stop-Smoke "install.ps1 has no `$MinBun line" }

# --- the fakes -------------------------------------------------------------------------
# One `.cmd` per program, and each is a single line that hands its arguments to the real
# `bun.exe` running the fake's JavaScript in scripts/install-windows-fakes/. Nothing is
# parsed in batch: the first Windows run of 0.4.2 died inside a batch fake's own parsing, and
# in JavaScript the fakes' own logic is exercised on Linux too (scripts/install.test.ts runs
# every one of them with fake arguments and a fake world).
#
# The environment the fakes read is in New-World below (FAKE_LOG, FAKE_BUN_VERSION, ...).
function Write-Fakes([string]$Dir, [string]$RealBun, [string]$FakesDir) {
  $wrappers = @(
    @{ Name = "claude"; Script = "claude.ts" },
    @{ Name = "bun"; Script = "bun.ts" },
    @{ Name = "git"; Script = "git.ts" },
    @{ Name = "gh"; Script = "gh.ts" }
  )
  foreach ($wrapper in $wrappers) {
    $text = @(
      "@echo off",
      "`"$RealBun`" `"$FakesDir\$($wrapper.Script)`" %*",
      "exit /b %errorlevel%"
    ) -join "`r`n"
    Set-Content -Path (Join-Path $Dir ($wrapper.Name + ".cmd")) -Value $text
  }
}

# --- one world -------------------------------------------------------------------------
function New-World([string]$Name, [hashtable]$Options = @{}) {
  $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("cc-smart-dev-kit-install-" + $Name + "-" + [Guid]::NewGuid().ToString("N"))
  $worldHome = Join-Path $dir "home"
  $bin = Join-Path $worldHome "bin"
  $log = Join-Path $worldHome "calls.log"
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  Set-Content -Path $log -Value ""
  Write-Fakes -Dir $bin -RealBun $script:RealBun -FakesDir $script:FakesDir
  $configDir = Join-Path $worldHome ".claude"
  if ($Options.ContainsKey("InstalledVersion")) {
    $pluginDir = Join-Path $configDir ("plugins\cache\cc-smart-dev-kit\cc-smart-dev-kit\" + $Options["InstalledVersion"])
    New-Item -ItemType Directory -Force -Path (Join-Path $pluginDir "dist") | Out-Null
    Set-Content -Path (Join-Path $pluginDir "dist\cli.js") -Value 'await import("the plugin");'
    Set-Content -Path (Join-Path $pluginDir "bunfig.toml") -Value "{}"
    $plugins = [ordered]@{ "cc-smart-dev-kit@cc-smart-dev-kit" = @(@{ scope = "user"; installPath = $pluginDir; version = $Options["InstalledVersion"] }) }
    if ($Options["OldPlugin"] -eq $true) {
      $plugins["anymodel@anymodel"] = @(@{ scope = "user"; installPath = "C:\nowhere"; version = "0.2.1" })
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $configDir "plugins") | Out-Null
    Set-Content -Path (Join-Path $configDir "plugins\installed_plugins.json") -Value ((@{ version = 2; plugins = $plugins } | ConvertTo-Json -Depth 8))
    Set-Content -Path (Join-Path $configDir "settings.json") -Value ((@{ enabledPlugins = @{ "cc-smart-dev-kit@cc-smart-dev-kit" = $true } } | ConvertTo-Json -Depth 8))
  }
  if ($Options["OldMarketplace"] -eq $true) {
    New-Item -ItemType Directory -Force -Path (Join-Path $configDir "plugins") | Out-Null
    Set-Content -Path (Join-Path $configDir "plugins\known_marketplaces.json") -Value ((@{ anymodel = @{ source = @{ source = "github"; repo = "example-org/anymodel" }; installLocation = "C:\old" } } | ConvertTo-Json -Depth 8))
  }
  if ($Options["ProgressFile"] -eq $true) {
    New-Item -ItemType Directory -Force -Path (Join-Path $configDir "cc-smart-dev-kit") | Out-Null
    Set-Content -Path (Join-Path $configDir "cc-smart-dev-kit\migrate-progress.json") -Value '{"done":["folders"],"version":1}'
  }
  if ($Options["RouterCopy"] -eq $true) {
    $copy = Join-Path $worldHome ".local\share\cc-smart-dev-kit\router.js"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $copy) | Out-Null
    Set-Content -Path $copy -Value "// the router"
  }
  # The launcher the fake setup copies into place: the same thing the real one does, run the
  # plugin's own CLI with the arguments it was given.
  $template = Join-Path $dir "launcher.cmd"
  Set-Content -Path $template -Value (@(
      "@echo off",
      "echo launcher %*>> `"$log`"",
      "call bun %*",
      "exit /b %errorlevel%"
    ))
  $answers = Join-Path $worldHome "answers"
  $answerLines = @()
  if ($Options.ContainsKey("Answers")) { $answerLines = $Options["Answers"] }
  Set-Content -Path $answers -Value ($answerLines -join "`r`n")
  return @{
    dir = $dir; home = $worldHome; bin = $bin; log = $log
    env = @{
      HOME = $worldHome
      USERPROFILE = $worldHome
      CLAUDE_CONFIG_DIR = $configDir
      PATH = $bin + ";" + $env:PATH
      CC_SMART_DEV_KIT_INSTALL_TTY = $answers
      FAKE_LOG = $log
      FAKE_LAUNCHER = $template
      FAKE_MARKETPLACE_VERSION = $marketplaceVersion
      FAKE_BUN_VERSION = $(if ($Options.ContainsKey("BunVersion")) { $Options["BunVersion"] } else { $minBun })
      FAKE_BUN_UPGRADE_TO = $minBun
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
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File $install @Arguments 2>&1 | Out-String
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

function Assert-Code([string]$What, $Result, [int]$Expected, $World = $null) {
  if ($Result.code -ne $Expected) {
    $calls = if ($null -eq $World) { "" } else { "`nthe calls log:`n" + ((Get-Calls $World) -join "`n") }
    Stop-Smoke "$What`: expected exit $Expected, got $($Result.code):`n$($Result.out)$calls"
  }
}

$passed = 0
# The case names, for the closing summary. A List, not `@()`: it never collapses to a
# single value, so its count and its contents always mean the list (the same rule the
# installer's own lists follow).
$names = [System.Collections.Generic.List[string]]::new()
try {
  # 1. A fresh machine, the browser done: the marketplaces, the plugin, migrate, setup,
  #    doctor, exit 0.
  $world = New-World "fresh" @{ Answers = @("y", "y", ("A" * 43), "n", "n") }
  $result = Invoke-Install $world @($repo)
  Assert-Code "a fresh machine" $result 0 $world
  Assert-Contains "a fresh machine" $result.out "[ok] 1/8 not inside a Claude Code session"
  Assert-Contains "a fresh machine" $result.out "[ok] 3/8 Bun $minBun is new enough (the plugin needs $minBun or newer)"
  Assert-Contains "a fresh machine" $result.out "[ok] 4/8 marketplaces added: $repo, thedotmack/claude-mem, anthropics/claude-plugins-official"
  Assert-Contains "a fresh machine" $result.out "[ok] 5/8 the plugin is installed ($marketplaceVersion)"
  Assert-Contains "a fresh machine" $result.out "[ok] 6/8 migrate finished (nothing to move on a machine without the old anymodel names)"
  Assert-Contains "a fresh machine" $result.out "[ok] 6/8 setup finished"
  Assert-Contains "a fresh machine" $result.out "[ok] 7/8 the browser's token is saved"
  Assert-Contains "a fresh machine" $result.out "[ok] 8/8 doctor: every check passed"
  $calls = Get-Calls $world
  foreach ($call in @("claude plugin marketplace add $repo", "claude plugin marketplace add thedotmack/claude-mem", "claude plugin marketplace add anthropics/claude-plugins-official", "claude plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user")) {
    if ($calls -notcontains $call) { Stop-Smoke "a fresh machine: `"$call`" was not called; the log is:`n$($calls -join "`n")" }
  }
  if (-not ($calls | Where-Object { $_ -like "bun --no-env-file --config=*dist/cli.js migrate" })) {
    Stop-Smoke "a fresh machine: migrate was not run through the plugin's own bundle; the log is:`n$($calls -join "`n")"
  }
  if (-not ($calls | Where-Object { $_ -like "bun --no-env-file --config=*dist/cli.js setup" })) {
    Stop-Smoke "a fresh machine: setup was not run through the plugin's own bundle"
  }
  if ($calls -notcontains "launcher doctor") { Stop-Smoke "a fresh machine: doctor did not run through the launcher" }
  $passed++
  $names.Add("a fresh machine")

  # 2. A second run does only what is missing.
  $before = (Get-Calls $world).Count
  $again = Invoke-Install $world @($repo)
  Assert-Code "a second run" $again 0 $world
  Assert-Contains "a second run" $again.out "[ok] 4/8 all three marketplaces are already added"
  Assert-Contains "a second run" $again.out "[ok] 5/8 the plugin is installed, at the marketplace's version ($marketplaceVersion)"
  $second = @(Get-Calls $world | Select-Object -Skip $before)
  if ($second | Where-Object { $_ -like "*marketplace add*" -or $_ -like "*plugin install*" -or $_ -like "*plugin update*" }) {
    Stop-Smoke "a second run added a marketplace or reinstalled the plugin:`n$($second -join "`n")"
  }
  $passed++
  $names.Add("a second run")

  # 3. The browser skipped: doctor's [x] is what is left, and the exit code is 3.
  $skipped = New-World "skipped" @{ Answers = @("n", "n", "n") }
  $result = Invoke-Install $skipped @($repo)
  Assert-Code "the browser skipped" $result 3 $skipped
  Assert-Contains "the browser skipped" $result.out "[x] 8/8 doctor found what is left"
  Assert-Contains "the browser skipped" $result.out "the browser token is not set, so the browser cannot connect"
  Assert-Contains "the browser skipped" $result.out "What is left:"
  Assert-Contains "the browser skipped" $result.out "the browser: "
  $passed++
  $names.Add("the exit code 3")

  # 4. An old-anymodel machine: migrate, then setup -- and the old plugin is asked about.
  $old = New-World "old" @{ Answers = @("y", "y", ("A" * 43), "n", "n", "n"); OldMarketplace = $true; InstalledVersion = $marketplaceVersion; OldPlugin = $true }
  $result = Invoke-Install $old @($repo)
  Assert-Code "an old anymodel machine" $result 0 $old
  Assert-Contains "an old anymodel machine" $result.out "[ok] 6/8 migrate finished"
  Assert-Contains "an old anymodel machine" $result.out "[ok] 6/8 setup finished"
  Assert-Contains "an old anymodel machine" $result.out "The old anymodel plugin is still installed. Remove it, and the old anymodel marketplace with it?"
  Assert-Contains "an old anymodel machine" $result.out "[ok] 6/8 the old anymodel plugin and marketplace are removed"
  $calls = (Get-Calls $old) -join "`n"
  if ($calls -notmatch "claude plugin uninstall anymodel@anymodel --scope user") { Stop-Smoke "an old anymodel machine: the old plugin was not uninstalled" }
  if ($calls -notmatch "claude plugin marketplace remove anymodel") { Stop-Smoke "an old anymodel machine: the old marketplace was not removed" }
  $passed++
  $names.Add("an old anymodel machine")

  # 5. The old plugin left in place: one line, and it is in what is left.
  $kept = New-World "kept" @{ Answers = @("y", "y", ("A" * 43), "n", "n", "n"); InstalledVersion = $marketplaceVersion; OldPlugin = $true }
  $result = Invoke-Install $kept @($repo)
  Assert-Code "the old plugin left" $result 0 $kept
  Assert-Contains "the old plugin left" $result.out "the old anymodel plugin was left in place"
  Assert-Contains "the old plugin left" $result.out "- the old anymodel plugin: claude plugin uninstall anymodel@anymodel"
  if ((Get-Calls $kept) -match "plugin uninstall") { Stop-Smoke "the old plugin left: it was uninstalled anyway" }
  $passed++
  $names.Add("the old plugin left in place")

  # 6. A half-moved machine: its progress file makes migrate run again, then setup.
  $half = New-World "half" @{ Answers = @("y", "y", ("A" * 43), "n", "n"); ProgressFile = $true }
  $result = Invoke-Install $half @($repo)
  Assert-Code "a half-moved machine" $result 0 $half
  Assert-Contains "a half-moved machine" $result.out "[ok] 6/8 migrate finished"
  Assert-Contains "a half-moved machine" $result.out "[ok] 6/8 setup finished"
  $passed++
  $names.Add("a half-moved machine")

  # 7. The gateway's restart: a router is on disk, and the person says yes.
  $router = New-World "router" @{ Answers = @("y", "y", ("A" * 43), "y", "y", "omniroute-key-abc123", "n"); RouterCopy = $true }
  $result = Invoke-Install $router @($repo)
  Assert-Code "the router restart" $result 0 $router
  Assert-Contains "the router restart" $result.out "A router is already installed here: setup restarts it"
  if (-not ((Get-Calls $router) | Where-Object { $_ -like "*gateway setup --backend-key-stdin omniroute --yes" })) {
    Stop-Smoke "the router restart: --yes did not reach gateway setup; the log is:`n$((Get-Calls $router) -join "`n")"
  }
  $passed++
  $names.Add("the gateway's restart")

  # 8. Inside a Claude Code session: refused, exit 2, nothing runs.
  $inside = New-World "inside" @{ Answers = @("n") }
  $result = Invoke-Install $inside @($repo) @{ CLAUDECODE = "1" }
  Assert-Code "inside a Claude Code session" $result 2 $inside
  Assert-Contains "inside a Claude Code session" $result.out "cannot run inside a Claude Code session"
  if ((Get-Calls $inside).Count -ne 0) { Stop-Smoke "inside a Claude Code session something ran: $((Get-Calls $inside) -join ", ")" }
  $passed++
  $names.Add("inside a Claude Code session")

  # 9. An old Bun, and the person says no: stopped, exit 2.
  $oldBun = New-World "old-bun" @{ BunVersion = "1.2.0"; Answers = @("n") }
  $result = Invoke-Install $oldBun @($repo)
  Assert-Code "an old Bun, no" $result 2 $oldBun
  Assert-Contains "an old Bun, no" $result.out "[x] Bun is still 1.2.0: cc-smart-dev-kit needs Bun $minBun or newer"
  if ((Get-Calls $oldBun) -contains "bun upgrade") { Stop-Smoke "an old Bun, no: bun upgrade ran anyway" }
  $passed++
  $names.Add("an old Bun answered no")

  # 10. No repository argument: one usage line, exit 2.
  $empty = New-World "usage"
  $result = Invoke-Install $empty @() @{ CC_SMART_DEV_KIT_REPO = "" }
  Assert-Code "no repository argument" $result 2 $empty
  Assert-Contains "no repository argument" $result.out "usage: powershell -File install.ps1 <owner>/<repo>"
  if ((Get-Calls $empty).Count -ne 0) { Stop-Smoke "no repository argument: something ran" }
  $passed++
  $names.Add("no repository argument")

  # 11. -DryRun prints the plan and changes nothing.
  $dry = New-World "dry"
  $result = Invoke-Install $dry @("-DryRun", $repo)
  Assert-Code "-DryRun" $result 0 $dry
  Assert-Contains "-DryRun" $result.out "cc-smart-dev-kit installer: dry run, the plan for this machine. Nothing is changed."
  Assert-Contains "-DryRun" $result.out "Dry run: nothing was written, nothing ran, and no network was reached."
  $calls = Get-Calls $dry
  if ($calls | Where-Object { $_ -like "claude *" -or $_ -like "git *" -or $_ -like "*dist/cli.js*" }) {
    Stop-Smoke "-DryRun ran something:`n$($calls -join "`n")"
  }
  if (Test-Path (Join-Path $dry.env.CLAUDE_CONFIG_DIR "plugins\known_marketplaces.json")) {
    Stop-Smoke "-DryRun wrote a marketplace record"
  }
  $passed++
  $names.Add("-DryRun")

  # 12. The two keys the person has: on stdin, never in an argument, never printed.
  $secrets = New-World "secrets" @{ Answers = @("y", "y", ("A" * 43), "y", "omniroute-key-abc123", "y", "tvly-key-abc123") }
  $result = Invoke-Install $secrets @($repo)
  Assert-Code "the secrets" $result 0 $secrets
  Assert-Contains "the secrets" $result.out "[ok] 7/8 the gateway is set up"
  Assert-Contains "the secrets" $result.out "[ok] 7/8 the Tavily key is saved"
  $calls = Get-Calls $secrets
  if (($calls | Where-Object { $_ -eq "stdin-nonempty" }).Count -ne 2) {
    Stop-Smoke "the secrets: a key did not reach its command on stdin:`n$($calls -join "`n")"
  }
  if (-not ($calls | Where-Object { $_ -like "stdin-43-chars" })) {
    Stop-Smoke "the secrets: the token did not reach `browser token` on stdin"
  }
  foreach ($secret in @("omniroute-key-abc123", "tvly-key-abc123", ("A" * 43))) {
    if (($calls -join "`n").Contains($secret)) { Stop-Smoke "a secret is in a fake's arguments: $secret" }
    if ($result.out.Contains($secret)) { Stop-Smoke "a secret was printed: $secret" }
  }
  $passed++
  $names.Add("the secrets")
} finally {
  Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Filter "cc-smart-dev-kit-install-*" -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "windows-install-smoke: $passed cases passed ($shell)"
foreach ($name in $names) { Write-Output "  - $name" }
exit 0
