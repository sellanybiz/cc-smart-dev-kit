# install.ps1 in a fake world, on a real Windows machine: the proof the Windows CI job runs
# (the way scripts/windows-hook-smoke.sh proves the hooks there). The cases are the ones
# scripts/install.test.ts proves for install.sh: a fresh machine, a second run, an
# old-anymodel machine, a half-moved machine, a machine with only the old plugin, a refusal
# inside a Claude Code session, an old Bun answered no, no repository argument, -DryRun, the
# secrets, the exit code 3 a doctor [x] gives, and the two GitHub ones -- a machine with no
# SSH key (the marketplace is added over HTTPS instead) and an account that cannot see the
# repository (the run stops and names it) -- plus a machine that has no gh at all.
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
# The minimum Bun the script checks, read from the script itself: this test never keeps a
# second copy of that number (src/build-info/bun.ts is its one home, and
# scripts/install.test.ts keeps the two installers equal to it).
$minBun = [regex]::Match((Get-Content -Raw $install), '(?m)^\$MinBun = "([^"]+)"').Groups[1].Value
if ([string]::IsNullOrEmpty($minBun)) { Stop-Smoke "install.ps1 has no MinBun line" }
# The version the installer ships with, read from the script itself for the same reason: the
# fake CLI answers it, the marketplace's copy declares it, and the installer refuses a CLI
# older than it (plugin/.claude-plugin/plugin.json is its one home).
$marketplaceVersion = [regex]::Match((Get-Content -Raw $install), '(?m)^\$InstallerVersion = "([^"]+)"').Groups[1].Value
if ([string]::IsNullOrEmpty($marketplaceVersion)) { Stop-Smoke "install.ps1 has no InstallerVersion line" }

# The line the fake `gateway check` prints for a code: the real command's own kind of line.
function Get-GatewayLine([string]$Code) {
  switch ($Code) {
    "0" { return "(ok) the gateway's OmniRoute key is accepted (http://127.0.0.1:20128, HTTP 200)" }
    "1" { return "[x] the gateway has no OmniRoute key yet, and OmniRoute answers at http://127.0.0.1:20128" }
    "3" { return "- the gateway could not be checked: OmniRoute does not answer at http://127.0.0.1:20128" }
    "4" { return "[x] OmniRoute refused the key in gateway.json (HTTP 401): it is not an OmniRoute API key" }
    default { return "- the gateway could not be checked" }
  }
}
# The fakes are `.cmd` wrappers around the real bun.exe running this folder's JavaScript:
# found before any world prepends itself to PATH, so the wrapper never calls itself.
$script:RealBun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrEmpty($script:RealBun)) { Stop-Smoke "bun is not on PATH (the fakes run on it)" }
$script:FakesDir = Join-Path $PSScriptRoot "install-windows-fakes"
if (-not (Test-Path $script:FakesDir)) { Stop-Smoke "scripts/install-windows-fakes is not there" }

# --- the fakes -------------------------------------------------------------------------
# One `.cmd` per program, and each is a single line that hands its arguments to the real
# `bun.exe` running the fake's JavaScript in scripts/install-windows-fakes/. Nothing is
# parsed in batch: the first Windows run of 0.4.2 died inside a batch fake's own parsing, and
# in JavaScript the fakes' own logic is exercised on Linux too (scripts/install.test.ts runs
# every one of them with fake arguments and a fake world).
#
# The environment the fakes read is in New-World below (FAKE_LOG, FAKE_BUN_VERSION, ...).
function Write-Fakes([string]$Dir, [string]$RealBun, [string]$FakesDir, [bool]$NoGh = $false) {
  $wrappers = @(
    @{ Name = "claude"; Script = "claude.ts" },
    @{ Name = "bun"; Script = "bun.ts" },
    @{ Name = "git"; Script = "git.ts" },
    @{ Name = "gh"; Script = "gh.ts" }
  )
  foreach ($wrapper in $wrappers) {
    if ($wrapper.Name -eq "gh" -and $NoGh) { continue }
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
  Write-Fakes -Dir $bin -RealBun $script:RealBun -FakesDir $script:FakesDir -NoGh ($Options["NoGh"] -eq $true)
  # A world with no gh: its wrapper is not written, and the GitHub CLI folders come out of PATH
  # too, so the gh a runner has installed cannot answer for a machine that has none.
  $worldPath = $bin + ";" + $env:PATH
  if ($Options["NoGh"] -eq $true) {
    $worldPath = @(($worldPath -split ";") | Where-Object { $_ -ne "" -and $_ -notmatch "[\\/]GitHub CLI" }) -join ";"
  }
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
  if ($Options.ContainsKey("UserServers")) {
    # User-scope MCP servers already in Claude Code's own config, as JSON (`.claude.json`).
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    Set-Content -Path (Join-Path $configDir ".claude.json") -Value $Options["UserServers"]
  }
  if ($Options["GatewayConfig"] -eq $true) {
    $config = Join-Path $worldHome ".config\cc-smart-dev-kit\gateway.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $config) | Out-Null
    Set-Content -Path $config -Value '{"backends":{"omniroute":{"apiKey":"the-router-key","baseUrl":"http://127.0.0.1:20128"}},"port":20100,"slots":{"cc-smart-dev-kit-worker":["omniroute:m1"]},"version":1}'
  }
  # The launcher the fake setup copies into place. It does what the real one does -- runs the
  # plugin's own CLI (bun, the two flags README, section Install uses, the installed bundle)
  # with the arguments it was given -- so `doctor` reaches the fake with its real argv. A
  # template that ran a bare `bun %*` is how this test's `doctor` quietly passed once: the
  # fake saw "doctor" alone, matched nothing, and exited 0.
  $pluginDir = Join-Path $configDir ("plugins\cache\cc-smart-dev-kit\cc-smart-dev-kit\" + $marketplaceVersion)
  $template = Join-Path $dir "launcher.cmd"
  Set-Content -Path $template -Value (@(
      "@echo off",
      "echo launcher %*>> `"$log`"",
      "call bun --no-env-file --config=`"$pluginDir\bunfig.toml`" `"$pluginDir\dist\cli.js`" %*",
      "exit /b %errorlevel%"
    ))
  $answers = Join-Path $worldHome "answers"
  $answerLines = @()
  if ($Options.ContainsKey("Answers")) { $answerLines = $Options["Answers"] }
  Set-Content -Path $answers -Value ($answerLines -join "`r`n")
  $gatewayCheck = $(if ($Options.ContainsKey("GatewayCheck")) { [string]$Options["GatewayCheck"] } else { "0" })
  $mcpStatus = $(if ($Options.ContainsKey("McpForeign")) { $Options["McpForeign"] } else { '{"servers":[]}' })
  return @{
    dir = $dir; home = $worldHome; bin = $bin; log = $log
    env = @{
      HOME = $worldHome
      USERPROFILE = $worldHome
      CLAUDE_CONFIG_DIR = $configDir
      PATH = $worldPath
      CC_SMART_DEV_KIT_INSTALL_TTY = $answers
      FAKE_LOG = $log
      FAKE_LAUNCHER = $template
      FAKE_MARKETPLACE_VERSION = $marketplaceVersion
      FAKE_BUN_VERSION = $(if ($Options.ContainsKey("BunVersion")) { $Options["BunVersion"] } else { $minBun })
      FAKE_BUN_UPGRADE_TO = $minBun
      FAKE_GIT_FAILS = $(if ($Options.ContainsKey("GitFails")) { $Options["GitFails"] } else { "no" })
      # What the plugin's own CLI answers, and what `gateway check` says (0 works, 1 no key
      # yet, 3 could not be judged, 4 the key is refused).
      FAKE_CLI_VERSION = $marketplaceVersion
      FAKE_GATEWAY_CHECK_CODE = $gatewayCheck
      FAKE_GATEWAY_CHECK_LINE = Get-GatewayLine $gatewayCheck
      FAKE_GATEWAY_KEY_REFUSED = $(if ($Options["GatewayKeyRefused"] -eq $true) { "yes" } else { "no" })
      FAKE_OMNIROUTE_PASSWORD_REFUSED = $(if ($Options["OmniRoutePasswordRefused"] -eq $true) { "yes" } else { "no" })
      # Which of the plugin's MCP servers are registered by something else, as JSON.
      FAKE_MCP_STATUS = $mcpStatus
      # The GitHub CLI: the login it answers, whether its account can see the repository, and
      # whether nobody is logged in at all (its own flag: an empty environment value cannot be
      # relied on to arrive as an empty variable, so FAKE_GH_LOGIN="" would not do).
      # And the way Claude Code's own add is refused on a machine with no GitHub SSH key.
      FAKE_GH_LOGIN = $(if ($Options.ContainsKey("GhLogin")) { $Options["GhLogin"] } else { "example-user" })
      FAKE_GH_LOGGED_OUT = $(if ($Options["GhLoggedOut"] -eq $true) { "yes" } else { "no" })
      FAKE_GH_VIEW_FAILS = $(if ($Options["GhViewFails"] -eq $true) { "yes" } else { "no" })
      FAKE_CLAUDE_SSH_REFUSED = $(if ($Options["ClaudeSshRefused"] -eq $true) { "yes" } else { "no" })
      FAKE_CLAUDE_ADD_NOT_FOUND = $(if ($Options["ClaudeAddNotFound"] -eq $true) { "yes" } else { "no" })
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
  # "Continue" for this call only: Windows PowerShell 5.1 turns a native command's stderr --
  # and install.ps1 writes its failures there -- into a TERMINATING error while this script's
  # ErrorActionPreference is "Stop", which killed the 5.1 run before any assertion. The lines
  # are the child's, and its exit code is read below either way.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    # The child's stdout and stderr, as text. 5.1 renders a native command's stderr as error
    # records that wrap and prefix every line, so each is taken as its message -- and nothing
    # goes through Out-String, which wraps long lines at the console width.
    $lines = @(
      & $shell -NoProfile -ExecutionPolicy Bypass -File $install @Arguments 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { "$($_.Exception.Message)" } else { [string]$_ }
      }
    )
    $out = $lines -join "`n"
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
    foreach ($key in $applied.Keys) { [Environment]::SetEnvironmentVariable($key, $applied[$key], "Process") }
  }
  return @{ code = $code; out = $out }
}

function Get-Calls($World) {
  return @(Get-Content -Path $World.log | Where-Object { $_ -ne "" })
}

# The one fenced `Language` block in README.md that holds this marker, taken as ONE line: the
# by-hand setup line a person pastes (README, section Install, step 3). The README is its one
# home, so this test reads it and never keeps a copy.
function Get-ByHandLine([string]$Language, [string]$Marker) {
  $readme = Join-Path $root "README.md"
  if (-not (Test-Path $readme)) { Stop-Smoke "README.md is not at the repo root" }
  $text = Get-Content -Raw $readme
  $pattern = '(?ms)^[ \t]*```' + $Language + '[ \t]*\r?\n(.*?)^[ \t]*```[ \t]*\r?$'
  $blocks = @([regex]::Matches($text, $pattern) | ForEach-Object { $_.Groups[1].Value })
  $found = @($blocks | Where-Object { $_.Contains($Marker) })
  if ($found.Count -ne 1) {
    Stop-Smoke "README.md must hold exactly one ``$Language`` block containing `"$Marker`": found $($found.Count)"
  }
  $body = $found | Select-Object -First 1
  $lines = @($body -split "\r?\n" | Where-Object { $_.Trim() -ne "" })
  if ($lines.Count -ne 1) {
    Stop-Smoke "the by-hand ``$Language`` setup must be ONE line to paste: found $($lines.Count)"
  }
  return ($lines | Select-Object -First 1).Trim()
}

# A PowerShell line run the way the person runs it -- in a PowerShell of the same version this
# test runs under -- with a world's environment: the README's by-hand line on native Windows.
function Invoke-PowerShellLine($World, [string]$Line) {
  $applied = @{}
  foreach ($key in $World.env.Keys) {
    $applied[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$World.env[$key], "Process")
  }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = (& $shell -NoProfile -ExecutionPolicy Bypass -Command $Line 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { "$($_.Exception.Message)" } else { [string]$_ }
    }) -join "`n"
  } finally {
    $ErrorActionPreference = $previous
    foreach ($key in $applied.Keys) { [Environment]::SetEnvironmentVariable($key, $applied[$key], "Process") }
  }
  return @{ out = $out }
}

function Assert-Contains([string]$What, [string]$Text, [string]$Expected) {
  if (-not $Text.Contains($Expected)) {
    Stop-Smoke "$What`: expected to find `"$Expected`" in:`n$Text"
  }
}

# True when the world's log holds a command whose line ENDS with this tail. The tail has no
# path separator in it on purpose: install.ps1 builds a Windows path (`...\dist\cli.js`), and
# an assertion written with `/` never matches it -- which is exactly how this test failed on
# its first Windows run.
function Test-Called($World, [string]$Tail) {
  return [bool]@(Get-Calls $World | Where-Object { $_.EndsWith($Tail) })
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
  $world = New-World "fresh" @{ Answers = @("y", ("A" * 43), "n", "n") }
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
  if (-not (Test-Called $world "cli.js migrate")) {
    Stop-Smoke "a fresh machine: migrate was not run through the plugin's own bundle; the log is:`n$($calls -join "`n")"
  }
  if (-not (Test-Called $world "cli.js setup")) {
    Stop-Smoke "a fresh machine: setup was not run through the plugin's own bundle"
  }
  if ($calls -notcontains "launcher doctor --json") { Stop-Smoke "a fresh machine: doctor --json did not run through the launcher" }
  # The git check's URL, whole: `"$Repo.git"` inside a string is member access and would have
  # asked git for "git@github.com:" (the fake says yes to anything, so only this line shows it).
  Assert-Contains "a fresh machine" ($calls -join "`n") "git ls-remote git@github.com:${repo}.git"
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
  $old = New-World "old" @{ Answers = @("y", "y", ("A" * 43), "n", "n"); OldMarketplace = $true; InstalledVersion = $marketplaceVersion; OldPlugin = $true }
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
  $kept = New-World "kept" @{ Answers = @("n", "y", ("A" * 43), "n", "n"); InstalledVersion = $marketplaceVersion; OldPlugin = $true }
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

  # 7. The gateway's restart: a router is on disk, the key in gateway.json is one OmniRoute
  #    refuses, and the person says yes to the restart and pastes a new key.
  $router = New-World "router" @{ Answers = @("y", ("A" * 43), "y", "y", "omniroute-key-abc123", "n"); RouterCopy = $true; GatewayCheck = 4 }
  $result = Invoke-Install $router @($repo)
  Assert-Code "the router restart" $result 0 $router
  Assert-Contains "the router restart" $result.out "A router is already installed here: setup restarts it"
  if (-not (Test-Called $router "gateway setup --backend-key-stdin omniroute --yes")) {
    Stop-Smoke "the router restart: --yes did not reach gateway setup; the log is:`n$((Get-Calls $router) -join "`n")"
  }
  $passed++
  $names.Add("the gateway's restart")

  # 7b. A gateway that already works: nobody is asked for a key at all, and the key in
  #     gateway.json is kept (the live trap of 2026-10-17).
  $working = New-World "working" @{ Answers = @("y", ("A" * 43), "y", "n"); GatewayCheck = 0; GatewayConfig = $true }
  $result = Invoke-Install $working @($repo)
  Assert-Code "a working gateway" $result 0 $working
  Assert-Contains "a working gateway" $result.out "the gateway already works, so no key is asked"
  Assert-Contains "a working gateway" $result.out "[ok] 7/8 the gateway is up to date"
  if ((Get-Calls $working) -match "--backend-key-stdin|--omniroute-password-stdin") {
    Stop-Smoke "a working gateway: a key was asked for anyway:`n$((Get-Calls $working) -join "`n")"
  }
  $passed++
  $names.Add("a working gateway")

  # 7c. No OmniRoute at all: nothing is asked, and the gateway is in what is left.
  $noOmniRoute = New-World "no-omniroute" @{ Answers = @("y", ("A" * 43), "y", "n"); GatewayCheck = 3 }
  $result = Invoke-Install $noOmniRoute @($repo)
  Assert-Code "no OmniRoute" $result 0 $noOmniRoute
  Assert-Contains "no OmniRoute" $result.out "the gateway is left as it is"
  Assert-Contains "no OmniRoute" $result.out "the gateway: README, section The AI gateway, says how to install and run OmniRoute"
  if ((Get-Calls $noOmniRoute) -match "--backend-key-stdin|--omniroute-password-stdin") {
    Stop-Smoke "no OmniRoute: a key was asked for anyway:`n$((Get-Calls $noOmniRoute) -join "`n")"
  }
  $passed++
  $names.Add("no OmniRoute at all")

  # 7d. A foreign MCP server: the installer asks, showing what runs instead, and `setup` runs
  #     again on a yes so the plugin registers its own WITH its record (live, 2026-10-17).
  $foreign = New-World "mcp-foreign" @{ Answers = @("y", "y", ("A" * 43), "n", "n"); McpForeign = '{"servers":[{"name":"playwright","runsWhat":"node C:/tools/browser-server.js","state":"foreign"}]}' }
  $result = Invoke-Install $foreign @($repo)
  Assert-Code "a foreign MCP server" $result 0 $foreign
  Assert-Contains "a foreign MCP server" $result.out 'The "playwright" server is registered by something else (node C:/tools/browser-server.js). Replace it with cc-smart-dev-kit''s?'
  Assert-Contains "a foreign MCP server" $result.out "[ok] 6/8 setup ran again: cc-smart-dev-kit's own MCP servers are registered"
  $calls = (Get-Calls $foreign) -join "`n"
  if ($calls -notmatch "claude mcp remove playwright --scope user") {
    Stop-Smoke "a foreign MCP server: it was not removed; the log is:`n$calls"
  }
  $passed++
  $names.Add("a foreign MCP server")

  # 7e. The same, answered no: the server is kept, and it is in what is left.
  $keepForeign = New-World "mcp-keep" @{ Answers = @("n", "y", ("A" * 43), "n", "n"); McpForeign = '{"servers":[{"name":"sequential-thinking","runsWhat":"node C:/tools/thinking.js","state":"foreign"}]}' }
  $result = Invoke-Install $keepForeign @($repo)
  Assert-Code "a foreign MCP server kept" $result 0 $keepForeign
  Assert-Contains "a foreign MCP server kept" $result.out 'the "sequential-thinking" server was left as it is'
  Assert-Contains "a foreign MCP server kept" $result.out 'the "sequential-thinking" MCP server (registered by something else)'
  if ((Get-Calls $keepForeign) -match "mcp remove") {
    Stop-Smoke "a foreign MCP server kept: it was removed anyway"
  }
  $passed++
  $names.Add("a foreign MCP server kept")

  # 7f. A serena of the person's own (Serena is retired in 0.6.0): it is in Claude Code's own
  #     config, `mcp status` leaves it out (as the real one does: src/mcp/mcp.test.ts), and the
  #     fake `claude mcp remove` really removes -- so a Serena step of the installer's own would
  #     show. Afterwards it is still registered, exactly as the person had it.
  $ownSerena = New-World "mcp-own-retired" @{ Answers = @("y", ("A" * 43), "n", "n"); UserServers = '{"mcpServers":{"serena":{"command":"C:/tools/their-uvx.exe","args":["serena","start-mcp-server"]}}}' }
  $result = Invoke-Install $ownSerena @($repo)
  Assert-Code "a serena of the person's own" $result 0 $ownSerena
  if ($result.out -match "serena" -or ((Get-Calls $ownSerena) -join "`n") -match "serena") {
    Stop-Smoke "a serena of the person's own: the installer touched it:`n$($result.out)"
  }
  $userConfig = Get-Content -Raw -Path (Join-Path $ownSerena.home ".claude\.claude.json") | ConvertFrom-Json
  if ($userConfig.mcpServers.serena.command -ne "C:/tools/their-uvx.exe" -or (@($userConfig.mcpServers.serena.args) -join " ") -ne "serena start-mcp-server") {
    Stop-Smoke "a serena of the person's own: it is not registered as the person had it any more:`n$(Get-Content -Raw -Path (Join-Path $ownSerena.home ".claude\.claude.json"))"
  }
  $passed++
  $names.Add("a serena of the person's own")

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
  if ($calls | Where-Object { $_ -like "claude *" -or $_ -like "git *" -or $_ -like "*cli.js*" }) {
    Stop-Smoke "-DryRun ran something:`n$($calls -join "`n")"
  }
  if (Test-Path (Join-Path $dry.env.CLAUDE_CONFIG_DIR "plugins\known_marketplaces.json")) {
    Stop-Smoke "-DryRun wrote a marketplace record"
  }
  $passed++
  $names.Add("-DryRun")

  # 12. A gateway with no key yet: the slots answer on Claude until one is added. This is the
  #     only case that runs a command through `$null |` (a command that must read nothing),
  #     and the only one that reaches `gateway setup --no-backend-key`. The check says there is
  #     no key yet and OmniRoute answers, so the dashboard password IS asked (and nothing is
  #     pasted).
  $noKey = New-World "no-key" @{ Answers = @("y", ("A" * 43), "y", "", "n"); GatewayCheck = 1 }
  $result = Invoke-Install $noKey @($repo)
  Assert-Code "a gateway with no key" $result 0 $noKey
  Assert-Contains "a gateway with no key" $result.out "Paste your OmniRoute dashboard password"
  Assert-Contains "a gateway with no key" $result.out "the gateway keeps the key it had"
  if (-not (Test-Called $noKey "gateway setup --no-backend-key")) {
    Stop-Smoke "a gateway with no key: setup did not run; the log is:`n$((Get-Calls $noKey) -join "`n")"
  }
  if ((Get-Calls $noKey) | Where-Object { $_ -like "*--backend-key-stdin*" -or $_ -like "*--omniroute-password-stdin*" }) {
    Stop-Smoke "a gateway with no key: the key path ran anyway"
  }
  $passed++
  $names.Add("a gateway with no key")

  # 13. The two keys the person has: on stdin, never in an argument, never printed.
  $secrets = New-World "secrets" @{ Answers = @("y", ("A" * 43), "y", "omniroute-key-abc123", "y", "tvly-key-abc123"); GatewayCheck = 4 }
  $result = Invoke-Install $secrets @($repo)
  Assert-Code "the secrets" $result 0 $secrets
  Assert-Contains "the secrets" $result.out "[ok] 7/8 the gateway is set up"
  Assert-Contains "the secrets" $result.out "[ok] 7/8 the Tavily key is saved"
  $calls = Get-Calls $secrets
  if (($calls | Where-Object { $_ -eq "stdin-nonempty" }).Count -ne 2) {
    Stop-Smoke "the secrets: a key did not reach its command on stdin:`n$($calls -join "`n")"
  }
  if (-not ($calls | Where-Object { $_ -eq "stdin-43-chars" })) {
    Stop-Smoke "the secrets: the token did not reach the token command on stdin"
  }
  foreach ($secret in @("omniroute-key-abc123", "tvly-key-abc123", ("A" * 43))) {
    if (($calls -join "`n").Contains($secret)) { Stop-Smoke "a secret is in a fake's arguments: $secret" }
    if ($result.out.Contains($secret)) { Stop-Smoke "a secret was printed: $secret" }
  }
  $passed++
  $names.Add("the secrets")

  # 14. A secret pasted with the bracketed-paste markers around it: the installer's own read
  #     strips them, so what reaches the command is the key itself (live, 2026-10-17). The
  #     fake logs the count of characters it read, and never the value.
  $pasted = New-World "pasted" @{ Answers = @("n", "y", "y", "$([char]27)[200~tvly-key-abc123$([char]27)[201~") }
  $result = Invoke-Install $pasted @($repo)
  # The browser is answered "n", so doctor still has its token line: the run ends 3, "installed,
  # with items left", and the browser is the item (the exit-code contract, README: Install).
  Assert-Code "a pasted secret" $result 3 $pasted
  Assert-Contains "a pasted secret" $result.out "What is left:"
  Assert-Contains "a pasted secret" $result.out "[ok] 7/8 the Tavily key is saved"
  if (-not ((Get-Calls $pasted) | Where-Object { $_ -eq "key-15-chars" })) {
    Stop-Smoke "a pasted secret: the markers reached the command; the log is:`n$((Get-Calls $pasted) -join "`n")"
  }
  $passed++
  $names.Add("a pasted secret")

  # 15. No GitHub SSH key: Claude Code adds the marketplace over ssh first and is refused, the
  #     same marketplace is added over HTTPS instead -- once -- and the run goes on (live,
  #     2026-10-17). The name it lands under comes from the repository's own marketplace file,
  #     so it is the same name either way, and every later step finds it.
  $noSsh = New-World "no-ssh" @{ Answers = @("y", ("A" * 43), "n", "n"); ClaudeSshRefused = $true }
  $result = Invoke-Install $noSsh @($repo)
  Assert-Code "no GitHub SSH key" $result 0 $noSsh
  Assert-Contains "no GitHub SSH key" $result.out "- 4/8 SSH to GitHub was refused, so the marketplace is added over HTTPS instead: https://github.com/${repo}.git"
  Assert-Contains "no GitHub SSH key" $result.out "[ok] 4/8 marketplaces added: https://github.com/${repo}.git, thedotmack/claude-mem, anthropics/claude-plugins-official"
  Assert-Contains "no GitHub SSH key" $result.out "[ok] 5/8 the plugin is installed ($marketplaceVersion)"
  $adds = @(Get-Calls $noSsh | Where-Object { $_ -eq "claude plugin marketplace add $repo" -or $_ -eq "claude plugin marketplace add https://github.com/${repo}.git" })
  if ($adds.Count -ne 2) {
    Stop-Smoke "no GitHub SSH key: the repository's source was not tried exactly twice; the log is:`n$((Get-Calls $noSsh) -join "`n")"
  }
  $passed++
  $names.Add("no GitHub SSH key")

  # 15b. A failure that is access, not ssh ("Repository not found"): reported as it always was,
  #      with the one attempt, and no HTTPS retry (a fallback is not a retry loop).
  $noAccessAtAll = New-World "not-found" @{ Answers = @("n"); ClaudeAddNotFound = $true }
  $result = Invoke-Install $noAccessAtAll @($repo)
  Assert-Code "a repository that cannot be read" $result 1 $noAccessAtAll
  Assert-Contains "a repository that cannot be read" $result.out "[x] adding the marketplace $repo failed"
  Assert-Contains "a repository that cannot be read" $result.out "claude plugin marketplace add $repo"
  if ((Get-Calls $noAccessAtAll) -match "claude plugin marketplace add https") {
    Stop-Smoke "a repository that cannot be read: it fell back to HTTPS anyway:`n$((Get-Calls $noAccessAtAll) -join "`n")"
  }
  $passed++
  $names.Add("a repository that cannot be read")

  # 16. The GitHub account cannot see the repository: stopped before any add, with the account,
  #     the owner and the invitation, and exit 1 (live, 2026-10-17).
  $noAccess = New-World "no-access" @{ Answers = @("n"); GhViewFails = $true }
  $result = Invoke-Install $noAccess @($repo)
  Assert-Code "the account cannot see the repository" $result 1 $noAccess
  Assert-Contains "the account cannot see the repository" $result.out "[x] the GitHub account example-user cannot read $repo"
  Assert-Contains "the account cannot see the repository" $result.out "ask the repository's owner for read access"
  Assert-Contains "the account cannot see the repository" $result.out "accept the invitation at https://github.com/${repo}/invitations"
  if ((Get-Calls $noAccess) -match "marketplace add") {
    Stop-Smoke "the account cannot see the repository: a marketplace was added anyway:`n$((Get-Calls $noAccess) -join "`n")"
  }
  $passed++
  $names.Add("the account cannot see the repository")

  # 17. gh is not installed: the read-access check is skipped, and the marketplace is added as
  #     before (the world's PATH has no gh at all).
  $noGh = New-World "no-gh" @{ Answers = @("y", ("A" * 43), "n", "n"); NoGh = $true }
  $result = Invoke-Install $noGh @($repo)
  Assert-Code "gh is not installed" $result 0 $noGh
  if ((Get-Calls $noGh) -match "^gh ") {
    Stop-Smoke "gh is not installed: gh was called anyway:`n$((Get-Calls $noGh) -join "`n")"
  }
  Assert-Contains "gh is not installed" $result.out "[ok] 4/8 marketplaces added: $repo, thedotmack/claude-mem, anthropics/claude-plugins-official"
  $passed++
  $names.Add("gh is not installed")

  # 18. gh is installed but NOBODY is logged in: both of its questions fail with gh's own "gh
  #     auth login" line, the installer skips the check, and the run goes on -- and neither of
  #     gh's two lines reaches the output (the script puts its stderr away, 2>$null).
  $loggedOut = New-World "logged-out" @{ Answers = @("y", ("A" * 43), "n", "n"); GhLoggedOut = $true }
  $result = Invoke-Install $loggedOut @($repo)
  Assert-Code "nobody is logged in" $result 0 $loggedOut
  Assert-Contains "nobody is logged in" $result.out "[ok] 4/8 marketplaces added: $repo, thedotmack/claude-mem, anthropics/claude-plugins-official"
  # Both questions were asked, and both were skipped: no account line, no marketplace over HTTPS.
  $calls = (Get-Calls $loggedOut) -join "`n"
  if ($calls -notmatch "gh repo view " -or $calls -notmatch "gh api user --jq .login") {
    Stop-Smoke "nobody is logged in: the check was not asked at all; the log is:`n$calls"
  }
  if ($calls -match "plugin marketplace add https") {
    Stop-Smoke "nobody is logged in: the marketplace was added over HTTPS; the log is:`n$calls"
  }
  if ($result.out -match "the GitHub account|gh auth login") {
    Stop-Smoke "nobody is logged in: gh's own words reached the installer's output:`n$($result.out)"
  }
  $passed++
  $names.Add("nobody is logged in")

  # 19. The README's own by-hand line for native Windows (section Install, step 3): it finds
  #     the newest installed version in Claude Code's cache by itself and runs setup from it
  #     through bun, with the plugin's two flags. Two versions are in the cache, and the
  #     OLDER one ("0.9.0") sorts after the newer ("0.10.0") as text, so only a version-order
  #     pick passes. Run as the person pastes it, with `--dry-run` added as the README says.
  $byHand = New-World "by-hand"
  $cache = Join-Path $byHand.home ".claude\plugins\cache\cc-smart-dev-kit\cc-smart-dev-kit"
  foreach ($version in @("0.9.0", "0.10.0")) {
    $dir = Join-Path $cache $version
    New-Item -ItemType Directory -Force -Path (Join-Path $dir "dist") | Out-Null
    Set-Content -Path (Join-Path $dir "dist\cli.js") -Value 'await import("the plugin");'
    Set-Content -Path (Join-Path $dir "bunfig.toml") -Value ""
  }
  $line = Get-ByHandLine "powershell" "plugins\cache"
  $result = Invoke-PowerShellLine $byHand ($line + " --dry-run")
  $newest = Join-Path $cache "0.10.0"
  $expected = "bun --no-env-file --config=$newest\bunfig.toml $newest\dist\cli.js setup --dry-run"
  $calls = @(Get-Calls $byHand)
  if ($calls -notcontains $expected) {
    Stop-Smoke "the by-hand Windows line: expected `"$expected`", got:`n$($calls -join "`n")`n$($result.out)"
  }
  if ($calls -match "0\.9\.0") {
    Stop-Smoke "the by-hand Windows line: it picked 0.9.0, not the newest version:`n$($calls -join "`n")"
  }
  $passed++
  $names.Add("the README's by-hand line on Windows")
} finally {
  Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Filter "cc-smart-dev-kit-install-*" -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "windows-install-smoke: $passed cases passed ($shell)"
foreach ($name in $names) { Write-Output "  - $name" }
exit 0
