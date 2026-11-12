# cc-smart-dev-kit's installer for native Windows (PowerShell 5.1 and pwsh): one command
# that does everything the machine can do by itself, and asks the person only for what only
# they have. install.sh is its macOS and Linux twin: the same steps, the same words, the
# same exit codes. This file is pure ASCII on purpose: a Windows console in another code
# page shows a tick or a dash as mojibake, so the marks are [ok], [x] and -.
#
# HOW IT IS STARTED -- the README has both lines, the first one for a private repository.
# Both download the script to a temp file and run THAT FILE, so the exit codes are real and
# a refusal never closes the window:
#
#   $f = Join-Path $env:TEMP "cc-smart-dev-kit-install.ps1"
#   gh api repos/<owner>/cc-smart-dev-kit/contents/install.ps1 -H "Accept: application/vnd.github.raw" |
#     Set-Content -Path $f
#   powershell -NoProfile -ExecutionPolicy Bypass -File $f <owner>/cc-smart-dev-kit
#   Remove-Item $f
#
# WHY THE REPOSITORY IS AN ARGUMENT: the plugin names no owner anywhere (its own rule), so
# the script cannot carry one. The argument is `<owner>/<name>`, the same source `claude
# plugin marketplace add` takes. With no argument the script reads CC_SMART_DEV_KIT_REPO;
# with neither it prints one usage line and stops.
#
# WHY EVERY QUESTION READS THE CONSOLE: run as a file, the script's own input is the console,
# and Read-Host (or Read-Host -AsSecureString for a secret, which is never echoed) reads it.
# A native command it starts gets that same console, never a pipe. So a command that must not
# read anything cannot eat an answer meant for a question.
# CC_SMART_DEV_KIT_INSTALL_TTY points the questions at a file of answers instead; it is for
# the tests, not for people.
#
# WHAT IT NEVER DOES: it never passes a secret on a command line (a command line is readable
# by every process on the machine and lands in PowerShell's history), never writes a secret
# file itself -- the plugin's own commands own that -- and never traces (Set-PSDebug -Trace
# would print every secret). It installs or upgrades nothing without asking. It refuses to
# run inside a Claude Code session, where it could replace the router that session's own
# model traffic goes through.
#
# THE STEPS, IN ORDER, each one line (a second run skips what is already done):
#
#   1. refuse inside a Claude Code session (CLAUDECODE, as `migrate` tests it);
#   2. `claude` on PATH, the GitHub CLI's account able to read the repository, and git able to
#      read it;
#   3. Bun present and at least MinBun (asked before it installs or upgrades one);
#   4. the three marketplaces added (this repository's, and the two companions'), over HTTPS
#      when Claude Code's own ssh add was refused;
#   5. the plugin installed -- or updated when it is older, or enabled when it is off;
#   6. `migrate`, then `setup` (the move decides by itself what to move; setup is what
#      installs the instructions and the launcher), then the old plugin, asked about;
#   7. the three things only the person has: the browser's token, the gateway's key, the
#      Tavily key -- each asked on the console, each skippable, never echoed, never printed;
#   8. `doctor --json`, then what is left (each failure with its fix), then the two closing
#      lines.
#
# EXIT CODES: 0 done (every step this script ran succeeded, and doctor is all [ok]); 3
# installed, with items left (doctor shows [x], or something was skipped -- the list at the
# end names each one and the line that finishes it); 1 a step failed (the line names the
# command that retries it, and running the installer again goes on from there); 2 refused
# (inside a Claude Code session, a question answered no, or no console to ask on).
#
# -DryRun prints the plan for this machine and changes nothing: it runs no `claude`, no
# setup, writes no file and reaches no network. It still reads this machine's local facts
# (which commands exist, their versions, what is already installed).
#
# A script that arrived half-downloaded cannot do anything: PowerShell parses the whole file
# before it runs a single statement, so a truncated one is a parse error and stops there --
# which is also why this file needs no main() wrapper, where install.sh does.

param(
  [Parameter(Position = 0)][string]$Repo = "",
  [switch]$DryRun
)

# The oldest Bun cc-smart-dev-kit runs on: MIN_BUN in src/build-info/bun.ts, which
# package.json's `engines.bun` and CI's setup-bun also follow. A test keeps the two equal
# (scripts/install.test.ts).
$MinBun = "1.4.3"

# The version this installer ships with: `version` in plugin/.claude-plugin/plugin.json of the
# repository this script was downloaded from. A test keeps the two equal
# (scripts/install.test.ts). It is read back off the installed CLI after the install or update
# (step 5): a CLI older than this script would refuse the options this script passes it, and
# that is exactly what happened on the first real run (2026-10-17: the installed CLI was 0.4.1,
# it had no `--tavily-key-stdin`, and the run died at the Tavily step).
$InstallerVersion = "4.5.0"

# The names this repository declares: the marketplace in .claude-plugin/marketplace.json
# and the plugin id in plugin/.claude-plugin/plugin.json. `claude plugin install` needs
# both halves of the id. The old names are what a 0.2.x machine still carries
# (README, section Moving from anymodel).
$Marketplace = "cc-smart-dev-kit"
$Plugin = "cc-smart-dev-kit@cc-smart-dev-kit"
$OldPlugin = "anymodel@anymodel"
$OldMarketplace = "anymodel"

# The marketplaces to add, in order: this repository's, then the two companions (README,
# section Companion plugins -- the plugin's dependencies come from them, and Claude Code
# installs a dependency only from a marketplace that is added). Each entry is a hashtable
# with the marketplace's own name (the key known_marketplaces.json uses) and the source
# `claude plugin marketplace add` takes.
#
# A hashtable per entry, never an array of pairs: `@(@($a, $b)) + $list` DOES NOT keep the
# pair together -- PowerShell enumerates that inner array into the pipeline, the loop then
# walks two strings followed by the pairs, and `$pair[0]` on a string is its first
# CHARACTER. That is the bug the first Windows CI run printed as
# "marketplaces added: c, x, thedotmack/claude-mem, ..." (0.4.2 review, 2026-10-16).
$MarketplacesToAdd = @(
  @{ Name = $Marketplace; Source = $Repo },
  @{ Name = "thedotmack"; Source = "thedotmack/claude-mem" },
  @{ Name = "claude-plugins-official"; Source = "anthropics/claude-plugins-official" }
)

function Write-Usage {
  # Started as a file: `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
  # <owner>/<repo>`, or `pwsh -File install.ps1 <owner>/<repo>`.
  Write-Output "usage: powershell -File install.ps1 <owner>/<repo> [-DryRun]   (or set CC_SMART_DEV_KIT_REPO=<owner>/<repo>)"
}

# --- the machine's paths (the same layout install.sh uses on macOS and Linux) -----------
# HOME first, then PowerShell's own: the plugin's paths come from the environment (its own
# rule), Git Bash exports HOME, and a test can point a run at a folder of its own.
$HomeDir = if ([string]::IsNullOrEmpty($env:HOME)) { $HOME } else { $env:HOME }
$ClaudeDir = if ([string]::IsNullOrEmpty($env:CLAUDE_CONFIG_DIR)) { Join-Path $HomeDir ".claude" } else { $env:CLAUDE_CONFIG_DIR }
$PluginsDir = Join-Path $ClaudeDir "plugins"
$KnownMarketplaces = Join-Path $PluginsDir "known_marketplaces.json"
$InstalledPlugins = Join-Path $PluginsDir "installed_plugins.json"
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$BinDir = Join-Path $HomeDir ".local\bin"
# Windows runs the .cmd launcher from PowerShell and cmd; the extensionless one is for Git
# Bash, which the plugin's `sh` parts need (docs/windows-setup.md).
$Launcher = Join-Path $BinDir "cc-smart-dev-kit.cmd"
# The router's own copy: `gateway setup` writes it, so its presence means a router was set
# up here before -- and may be running, which is what the restart question is about.
$RouterCopy = Join-Path $HomeDir ".local\share\cc-smart-dev-kit\router.js"
# The Tavily key file setup reads a key from: a person who already has one there is not asked
# for a key again (the same rule `readTavilyKey` follows: environment first, then this file).
$TavilyKeyFile = Join-Path $ClaudeDir "cc-smart-dev-kit\tavily.key"

# --- output ----------------------------------------------------------------------------
function Write-Step([string]$Line) { Write-Output "[ok] $Line" }
function Write-Skip([string]$Line) { Write-Output "- $Line" }

# What is left when the run ends: one line an item, each with the exact command that
# finishes it. Filled in by the steps that skip something. A List, not `@()`: it never
# collapses to a single value, so its count and its join always mean the list.
$Left = [System.Collections.Generic.List[string]]::new()

# A step that failed: what failed, and the command that retries just that step.
function Stop-Failed([string]$What, [string[]]$Retry) {
  [Console]::Error.WriteLine("[x] $What")
  [Console]::Error.WriteLine("  Retry just that step with:")
  foreach ($command in $Retry) { [Console]::Error.WriteLine("    $command") }
  [Console]::Error.WriteLine("  Then run this installer again: it goes on from there.")
  exit 1
}

# Refused: nothing has been changed yet -- every refusal comes before the first write -- so
# the machine is as it was. 2, so a script around this installer can tell a refusal from a
# failure.
function Stop-Refused([string]$Why, [string[]]$Retry) {
  [Console]::Error.WriteLine("[x] $Why")
  if ($Retry.Count -gt 0) {
    [Console]::Error.WriteLine("  Run this, then run the installer again:")
    foreach ($command in $Retry) { [Console]::Error.WriteLine("    $command") }
  }
  exit 2
}

# --- the console -----------------------------------------------------------------------
# Every question writes its answer into $script:Answer (never into a captured expression:
# the prompt would come with it). A function's own `$Answer = ...` would stay inside that
# function, and the question would look unanswered.
$script:Answer = ""
$script:Answers = $null
$script:AnswerIndex = 0

# Opens the console: the answers file when CC_SMART_DEV_KIT_INSTALL_TTY names one (the
# tests), else the console itself. Called before the first question -- and a dry run asks
# none, so it never needs one.
function Assert-Console {
  if (-not [string]::IsNullOrEmpty($env:CC_SMART_DEV_KIT_INSTALL_TTY)) {
    if (-not (Test-Path $env:CC_SMART_DEV_KIT_INSTALL_TTY)) {
      Stop-Refused "no console to ask on ($env:CC_SMART_DEV_KIT_INSTALL_TTY is not there): run this installer in your own terminal" @((Get-ReadmeLine))
    }
    if ($null -eq $script:Answers) {
      $script:Answers = [System.IO.File]::ReadAllLines($env:CC_SMART_DEV_KIT_INSTALL_TTY)
    }
    return
  }
  if ($Host.Name -eq "ServerRemoteHost" -or -not [Environment]::UserInteractive) {
    Stop-Refused "no console to ask on: run this installer in your own terminal" @((Get-ReadmeLine))
  }
}

# One line from the console; $script:Answer is empty when the answers run out.
function Read-OneLine {
  if ($null -ne $script:Answers) {
    if ($script:AnswerIndex -lt $script:Answers.Count) {
      $script:Answer = $script:Answers[$script:AnswerIndex]
      $script:AnswerIndex = $script:AnswerIndex + 1
      return
    }
    $script:Answer = ""
    return
  }
  $script:Answer = [string](Read-Host)
}

# A yes/no question; $script:Answer is "no" unless the person writes yes.
function Read-Yes([string]$Question) {
  if ($null -ne $script:Answers) {
    Write-Output "$Question [y/N] "
    Read-OneLine
  } else {
    $script:Answer = [string](Read-Host -Prompt "$Question [y/N]")
  }
  if ($script:Answer -match "^(y|yes)$") { $script:Answer = "yes" } else { $script:Answer = "no" }
}

# A secret: never echoed, never printed, never on a command line, and never in a child's
# environment (PowerShell keeps variables and the environment apart). The caller clears
# $script:Answer the moment it has copied it. The line is cleaned first (Clear-Secret).
function Read-Secret([string]$Prompt) {
  if ($null -ne $script:Answers) {
    Write-Output "$Prompt "
    Read-OneLine
  } else {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $script:Answer = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  Clear-Secret
}

# The line a secret read just gave, cleaned. Many terminals wrap a PASTE in the bracketed-paste
# markers ESC[200~ ... ESC[201~, and a read that echoes nothing keeps every character -- so a
# pasted token or key reached the plugin's own command with those markers in it and was refused
# as the wrong shape (live, 2026-10-17). The two markers go first (as SEQUENCES: dropping every
# control character first would leave "[200~" behind), then every other control character, then
# the ends trimmed. Printable characters stay, a non-ASCII password included.
# install.sh's clean_secret and the plugin's own cleanSecretLine (src/cli/secret-line.ts) do
# exactly the same: keep the three in step.
function Clear-Secret {
  $escape = [char]27
  $script:Answer = $script:Answer -replace ([regex]::Escape("${escape}[200~")), ""
  $script:Answer = $script:Answer -replace ([regex]::Escape("${escape}[201~")), ""
  $script:Answer = ($script:Answer -replace "[\x00-\x1F\x7F]", "").Trim()
}

# --- reading this machine's state ------------------------------------------------------
# One field out of a JSON file. An empty string when the file, the path or the value is not
# there (PowerShell's own JSON reader: no other tool is needed).
function Get-JsonField([string]$File, [string]$Field) {
  if (-not (Test-Path $File)) { return "" }
  try { $data = Get-Content -Raw -Path $File | ConvertFrom-Json } catch { return "" }
  $value = $data
  foreach ($part in $Field.Split(".")) {
    if ($null -eq $value) { return "" }
    $property = $value.PSObject.Properties[$part]
    if ($null -eq $property) { return "" }
    $value = $property.Value
  }
  if ($null -eq $value) { return "" }
  return [string]$value
}

function Test-JsonKey([string]$File, [string]$Key) {
  if (-not (Test-Path $File)) { return $false }
  try { $data = Get-Content -Raw -Path $File | ConvertFrom-Json } catch { return $false }
  return $null -ne $data.PSObject.Properties[$Key]
}

# The user-scope install of the plugin: its folder, Claude Code's own record.
function Get-InstalledPath {
  if (-not (Test-Path $InstalledPlugins)) { return "" }
  try { $data = Get-Content -Raw -Path $InstalledPlugins | ConvertFrom-Json } catch { return "" }
  $pluginList = $data.plugins
  if ($null -eq $pluginList) { return "" }
  $entries = $pluginList.PSObject.Properties["$Plugin"]
  if ($null -eq $entries) { return "" }
  foreach ($entry in @($entries.Value)) {
    if ($entry.scope -eq "user") { return [string]$entry.installPath }
  }
  return ""
}

function Get-InstalledVersion {
  if (-not (Test-Path $InstalledPlugins)) { return "" }
  try { $data = Get-Content -Raw -Path $InstalledPlugins | ConvertFrom-Json } catch { return "" }
  $pluginList = $data.plugins
  if ($null -eq $pluginList) { return "" }
  $entries = $pluginList.PSObject.Properties["$Plugin"]
  if ($null -eq $entries) { return "" }
  foreach ($entry in @($entries.Value)) {
    if ($entry.scope -eq "user") { return [string]$entry.version }
  }
  return ""
}

# True when Claude Code has the plugin turned on: the settings key `install` writes.
function Test-PluginEnabled {
  if (-not (Test-Path $SettingsFile)) { return $false }
  try { $data = Get-Content -Raw -Path $SettingsFile | ConvertFrom-Json } catch { return $false }
  $enabledPlugins = $data.enabledPlugins
  if ($null -eq $enabledPlugins) { return $false }
  $enabled = $enabledPlugins.PSObject.Properties["$Plugin"]
  return $null -ne $enabled -and $enabled.Value -eq $true
}

# True when the old plugin is still installed under its old id: `migrate` removes it, but
# only after a yes on a console.
function Test-OldPluginInstalled {
  if (-not (Test-Path $InstalledPlugins)) { return $false }
  try { $data = Get-Content -Raw -Path $InstalledPlugins | ConvertFrom-Json } catch { return $false }
  $pluginList = $data.plugins
  if ($null -eq $pluginList) { return $false }
  return $null -ne $pluginList.PSObject.Properties["$OldPlugin"]
}

# The version the marketplace's own copy declares: what `claude plugin install` would put
# in place now. `<installLocation>/plugin` is the plugin's folder inside this repository
# (marketplace.json's `source`), so the manifest sits there.
function Get-MarketplaceVersion {
  # `${Marketplace}` and not `$Marketplace`: inside a double-quoted string PowerShell reads a
  # variable followed by `.` as MEMBER ACCESS, so `"$Marketplace.installLocation"` was the
  # marketplace's name alone, with the property missing (the same trap as `$Repo:`).
  $location = Get-JsonField $KnownMarketplaces "${Marketplace}.installLocation"
  if ([string]::IsNullOrEmpty($location)) { return "" }
  return Get-JsonField (Join-Path $location "plugin\.claude-plugin\plugin.json") "version"
}

# "Already added" is Claude Code's own record, known_marketplaces.json, keyed by the
# marketplace's name -- proved live: a source already added under another name (the rename
# from anymodel) was NOT reused, and a second marketplace was made instead, so only the name
# answers the question. This is the file the plugin's own `marketplaceAdded` reads.
function Test-MarketplaceAdded([string]$Name) {
  return Test-JsonKey $KnownMarketplaces $Name
}

# Claude Code's other record of a marketplace: the user settings' `extraKnownMarketplaces`,
# which `claude plugin marketplace add` writes with the entry's `source`. `setup` reads this
# one (it writes its `autoUpdate` key into the entry), so a marketplace the first record holds
# and this one lost -- another tool rewriting settings.json -- stops `setup`. Only the add
# writes the entry whole, so only the add repairs it: proved live that a repeat add of a
# marketplace already on disk declares it again and fetches nothing
# (docs/claude-code-contract.md).
#
# The same test `setup` makes (`marketplaceKnown`): the entry is an object. Three answers: a
# missing file is "not declared"; a file this reader cannot parse (ConvertFrom-Json refuses
# keys that differ only in case, which Claude Code and setup read fine) is NOT judged here --
# `setup` reads it with the plugin's own reader, and a repair loop cannot fix a file Claude
# Code reads differently -- so it counts as declared; a parsed file answers by the entry.
function Test-MarketplaceDeclared([string]$Name) {
  if (-not (Test-Path $SettingsFile)) { return $false }
  try { $data = Get-Content -Raw -Path $SettingsFile | ConvertFrom-Json } catch { return $true }
  $declared = $data.extraKnownMarketplaces
  if ($null -eq $declared) { return $false }
  $entry = $declared.PSObject.Properties[$Name]
  return $null -ne $entry -and $entry.Value -is [System.Management.Automation.PSCustomObject]
}

# True when this machine can run the gateway's router: on Windows it is a per-user Scheduled
# Task, which needs PowerShell (the plugin's own rule, `routerServiceKind`).
function Test-GatewayServicePossible {
  return $null -ne (Get-Command powershell -ErrorAction SilentlyContinue)
}

# True when version $1 is at least $2. A numeric compare, field by field, so 1.10.0 is newer
# than 1.4.3. A pre-release of the minimum itself (1.4.3-canary.1) counts as older, exactly
# as `bunTooOld` in src/build-info/bun.ts counts it: it may be built before the fix.
function Test-VersionAtLeast([string]$Have, [string]$Need) {
  $haveText = $Have.TrimStart("v")
  $pre = $false
  if ($haveText.Contains("-")) {
    $haveText = $haveText.Substring(0, $haveText.IndexOf("-"))
    $pre = $true
  }
  $haveParts = $haveText.Split(".")
  $needParts = $Need.Split(".")
  for ($index = 0; $index -lt 3; $index++) {
    $havePart = 0
    $needPart = 0
    if ($index -lt $haveParts.Count) { [void][int]::TryParse($haveParts[$index], [ref]$havePart) }
    if ($index -lt $needParts.Count) { [void][int]::TryParse($needParts[$index], [ref]$needPart) }
    if ($havePart -gt $needPart) { return $true }
    if ($havePart -lt $needPart) { return $false }
  }
  return -not $pre
}

# A path as one word for the console a person pastes it into.
function Get-ShellWord([string]$Path) {
  if ($Path -match "^[A-Za-z0-9_./\\-]+$") { return $Path }
  return "'" + $Path.Replace("'", "''") + "'"
}

# The plugin's own CLI, in the exact form README, section Install uses: this machine's bun,
# the two flags (Bun would otherwise read the folder's own `.env` files and its `bunfig.toml`)
# and the installed bundle. ONE home for those three, splatted into every call, so a call that
# pipes a secret can put the pipeline on the NATIVE command: a function in a pipeline receives
# the input as `$input` and hands the child nothing (that is how `browser token` got an empty
# stdin on the runner).
# Runs the plugin's own CLI. The caller decides input.
function Invoke-Cli([string[]]$CliArgs) {
  & $Bun @cliArgv @CliArgs
}

# The same, reading nothing: a command that never asks the person must not be able to eat an
# answer meant for a question.
function Invoke-CliQuiet([string[]]$CliArgs) {
  $null | & $Bun @cliArgv @CliArgs
}

# A native command's output and its stderr, as one string. Windows PowerShell turns a native
# command's stderr into error records whose own rendering prefixes and WRAPS every line, so
# each record is taken as its message: the text stays what the command wrote, and a long
# doctor line is still one line.
function Get-CommandText([scriptblock]$Command) {
  $lines = @(
    & $Command 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { "$($_.Exception.Message)" } else { [string]$_ }
    }
  )
  return ($lines -join "`n")
}

# Hands a SECRET to the plugin's own CLI on stdin, encoded UTF-8 WITHOUT a BOM. Windows
# PowerShell 5.1 encodes what it pipes with $OutputEncoding, which is ASCII by default there: a
# key with any non-ASCII character would reach the command as "?". The previous value is put
# back afterwards, so the rest of the run is untouched.
function Send-SecretToCli([string]$Secret, [string[]]$CliArgs) {
  $previousEncoding = $OutputEncoding
  try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $Secret | & $Bun @cliArgv @CliArgs
  } finally {
    $OutputEncoding = $previousEncoding
  }
}

# A native command's STDOUT as one string, and nothing of its stderr: a command whose stdout is
# JSON must not have a warning line glued to it. (Windows PowerShell renders a native command's
# stderr as error records; this takes only the plain strings.)
function Get-CommandStdout([scriptblock]$Command) {
  $lines = @(& $Command 2>$null | ForEach-Object { [string]$_ })
  return ($lines -join "`n")
}

# The line that retries one of the plugin's own commands, once it is installed: the launcher
# when setup has put it in place, else the exact `bun --no-env-file ...` form. Every hint and
# retry line uses this, so a machine whose launcher is not there yet reads a line that works.
function Get-PluginCommand([string[]]$CliArgs) {
  $joined = $CliArgs -join " "
  if (Test-Path $Launcher) { return "$Launcher $joined" }
  return "bun --no-env-file --config=$(Get-ShellWord "$PluginDir\bunfig.toml") $(Get-ShellWord "$PluginDir\dist\cli.js") $joined"
}

# The README's own one-line form, with this repository in it: what a person runs when there
# is no console to ask on.
function Get-ReadmeLine {
  return "powershell -File install.ps1 $Repo"
}

# One pass over the plugin's servers registered by something else: show what runs instead, and
# ask. A name is asked about ONCE per run ($script:McpAsked), so the second pass -- after the
# Tavily key, whose arrival changes what the plugin registers -- brings up only what is new. A
# yes removes the server and runs `setup` again, so the plugin registers its own WITH its
# record (that record is what lets `restore` take it back later).
$script:McpAsked = ""
function Invoke-ForeignMcpPass([string]$Label) {
  # The command's STDOUT only: a stderr line (a warning, say) must not reach ConvertFrom-Json.
  $statusText = Get-CommandStdout { Invoke-CliQuiet @("mcp", "status", "--json") }
  $servers = @()
  try {
    $servers = @((ConvertFrom-Json -InputObject $statusText).servers)
  } catch {
    # Not JSON (the command failed, or answered nothing): nothing is foreign, so nothing is
    # asked. A machine this cannot read is one where setup's own lines say what is wrong.
    $servers = @()
  }
  $replaced = $false
  foreach ($server in @($servers | Where-Object { $_.state -eq "foreign" })) {
    $name = [string]$server.name
    if ($script:McpAsked.Contains(" $name ")) { continue }
    $script:McpAsked = "$script:McpAsked $name "
    Read-Yes "$Label The `"$name`" server is registered by something else ($($server.runsWhat)). Replace it with cc-smart-dev-kit's?"
    if ($script:Answer -eq "yes") {
      & $ClaudeBin mcp remove $name --scope user
      if ($LASTEXITCODE -ne 0) {
        Stop-Failed "removing the old `"$name`" server failed" @("claude mcp remove $name --scope user")
      }
      $replaced = $true
    } else {
      Write-Skip "$Label the `"$name`" server was left as it is: run ``claude mcp remove $name --scope user``, then ``$(Get-PluginCommand @("setup"))``"
      $Left.Add("the `"$name`" MCP server (registered by something else): claude mcp remove $name --scope user ; $(Get-PluginCommand @("setup"))")
    }
  }
  if ($replaced) {
    Invoke-Cli @("setup")
    if ($LASTEXITCODE -ne 0) {
      Stop-Failed "setup failed" @((Get-PluginCommand @("setup")))
    }
    Write-Step "$Label setup ran again: cc-smart-dev-kit's own MCP servers are registered"
  }
}

# --- the run ---------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($Repo)) { $Repo = [string]$env:CC_SMART_DEV_KIT_REPO }
if ([string]::IsNullOrEmpty($Repo)) {
  Write-Usage
  exit 2
}
if ($Repo -notmatch "/") {
  Write-Output "install.ps1: the repository is <owner>/<name>, not `"$Repo`""
  Write-Usage
  exit 2
}

# The Bun this script will use, filled in by step 3.
$Bun = ""
$BunVersion = ""

if ($DryRun) {
  Write-Output "cc-smart-dev-kit installer: dry run, the plan for this machine. Nothing is changed."
  Write-Output "  repository:   $Repo"
  Write-Output "  marketplaces: $Repo, thedotmack/claude-mem, anthropics/claude-plugins-official"
  Write-Output "  plugin:       $Plugin, at the user scope"
} else {
  # The console, before the first change: every real run asks something (the Bun question,
  # `migrate` and `setup` ask their own), and a refusal must leave the machine exactly as it
  # was. A dry run asks nothing and needs none.
  Assert-Console
}

# --- 1. inside a Claude Code session ---------------------------------------------------
if (-not [string]::IsNullOrEmpty($env:CLAUDECODE)) {
  Stop-Refused "this installer cannot run inside a Claude Code session: it may replace the router this session's own model traffic goes through." @("open your own terminal and run the installer there")
}
Write-Step "1/8 not inside a Claude Code session"

# --- 2. claude, and git can read the repository ----------------------------------------
$ClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue
if ($null -eq $ClaudeCommand) {
  Stop-Failed "claude is not on PATH: the plugin is installed with Claude Code's own commands" @("install Claude Code: https://code.claude.com")
}
$ClaudeBin = $ClaudeCommand.Source

# A private repository needs the person's git credentials. The check never waits for one
# (GIT_TERMINAL_PROMPT=0, and ssh in BatchMode): a prompt in the middle of an installer is
# worse than a line saying how to fix it. SSH first, then HTTPS -- the order Claude Code's
# own marketplace clone uses. The two settings are put back afterwards, so the rest of the
# run is not left with them.
function Test-GitCanRead {
  if ($DryRun) { return $true }
  if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) { return $false }
  $hadPrompt = Test-Path env:GIT_TERMINAL_PROMPT
  $savedPrompt = $env:GIT_TERMINAL_PROMPT
  $hadSsh = Test-Path env:GIT_SSH_COMMAND
  $savedSsh = $env:GIT_SSH_COMMAND
  try {
    $env:GIT_TERMINAL_PROMPT = "0"
    $env:GIT_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=8"
    & git ls-remote "git@github.com:${Repo}.git" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
    & git ls-remote "https://github.com/${Repo}.git" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } finally {
    if ($hadPrompt) { $env:GIT_TERMINAL_PROMPT = $savedPrompt } else { Remove-Item env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue }
    if ($hadSsh) { $env:GIT_SSH_COMMAND = $savedSsh } else { Remove-Item env:GIT_SSH_COMMAND -ErrorAction SilentlyContinue }
  }
}
# Can the GitHub CLI's account read the repository? That account is the one `gh auth setup-git`
# wires into git, and without read access no marketplace of this repository can be added -- no
# retry helps until its owner grants the invitation. Nothing is asked when gh is missing, when
# nobody is logged in, or when the account can see the repository: a machine without gh is
# installed as before. The account is named from `gh api user --jq .login`, the one call that
# also proves somebody is logged in; when it answers nothing (gh offline, say) the check is
# skipped and the marketplace steps below report their own failure.
#
# Both calls put gh's stderr away (2>$null): its own "Could not resolve to a Repository ..." and
# "please run: gh auth login" lines are not this script's words to print, and the check says what
# it found itself. install.sh silences the same two (>/dev/null 2>&1), so the two twins print the
# same lines on the same machine. A native command's stderr redirected to $null is safe here:
# this script sets no $ErrorActionPreference, so it runs at the default "Continue" -- Windows
# PowerShell 5.1 only turns a native command's stderr into a terminating error under "Stop".
function Assert-RepoReadAccess {
  if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) { return }
  $null | & gh repo view $Repo --json name 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return }
  $login = [string](@($null | & gh api user --jq .login 2>$null) | Select-Object -First 1)
  if ([string]::IsNullOrEmpty($login)) { return }
  Stop-Failed "the GitHub account $login cannot read ${Repo}" @("ask the repository's owner for read access", "accept the invitation at https://github.com/${Repo}/invitations")
}

# The lines that mean ssh to GitHub was refused, and not that the repository is out of reach.
# ssh's own two come first; git's summary line follows EITHER failure, so a "Repository not
# found" beside it is access, not ssh, and the HTTPS form cannot fix that (live, 2026-10-17).
function Test-SshRefused([string]$Text) {
  if ($Text -match "Permission denied \(publickey\)" -or $Text -match "Host key verification failed") { return $true }
  if ($Text -match "Could not read from remote repository") { return $Text -notmatch "Repository not found" }
  return $false
}

if (Test-GitCanRead) {
  if ($DryRun) {
    Write-Skip "2/8 claude found: $ClaudeBin; the dry run reaches no network, so git is not checked"
  } else {
    Write-Step "2/8 claude found: $ClaudeBin, and git can read $Repo"
  }
} elseif ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
  Stop-Failed "git is not on PATH, and a private repository needs it (Git for Windows brings it)" @("install Git for Windows: https://git-scm.com/download/win")
} else {
  # git's own line below names git credentials; when git is there and the GitHub account cannot
  # see the repository at all, that sends the person to fix credentials they already have -- so
  # gh is asked, and names the account instead (live, 2026-10-17).
  Assert-RepoReadAccess
  Stop-Failed "git cannot read ${Repo}: a private repository needs your git credentials" @("gh auth login", "gh auth setup-git")
}

# --- 3. Bun ----------------------------------------------------------------------------
$BunCommand = Get-Command bun -ErrorAction SilentlyContinue
if ($null -ne $BunCommand) { $Bun = $BunCommand.Source }
if (-not [string]::IsNullOrEmpty($Bun)) {
  $BunVersion = (& $Bun --version 2>$null | Select-Object -First 1)
}
if ([string]::IsNullOrEmpty($Bun)) {
  if ($DryRun) {
    Write-Skip "3/8 Bun is not installed: the plan asks to install it (the plugin needs $MinBun or newer), and without Bun it cannot read what is already installed"
  } else {
    Read-Yes "3/8 Bun is not installed. Install it with Bun's own PowerShell installer (powershell -c `"irm bun.sh/install.ps1 | iex`")?"
    if ($script:Answer -eq "no") {
      Stop-Refused "Bun was not installed: cc-smart-dev-kit needs Bun $MinBun or newer" @("powershell -c `"irm bun.sh/install.ps1 | iex`"")
    }
    Write-Output "  installing Bun (https://bun.sh/docs/installation)..."
    & powershell -c "irm bun.sh/install.ps1 | iex"
    if ($LASTEXITCODE -ne 0) {
      Stop-Failed "the Bun installer failed" @("powershell -c `"irm bun.sh/install.ps1 | iex`"")
    }
    # Bun's installer puts the binary under BUN_INSTALL (`%USERPROFILE%\.bun` unless the
    # person set that), and adds the folder to the PATH of new shells -- not to this
    # process's.
    $BunInstall = if ([string]::IsNullOrEmpty($env:BUN_INSTALL)) { Join-Path $HomeDir ".bun" } else { $env:BUN_INSTALL }
    $BunCommand = Get-Command bun -ErrorAction SilentlyContinue
    if ($null -ne $BunCommand) {
      $Bun = $BunCommand.Source
    } elseif (Test-Path (Join-Path $BunInstall "bin\bun.exe")) {
      $Bun = Join-Path $BunInstall "bin\bun.exe"
    } else {
      Stop-Failed "Bun was installed, but it is not on PATH and not in $BunInstall\bin" @('$env:PATH = "' + $BunInstall + '\bin;$env:PATH"')
    }
    $BunVersion = (& $Bun --version 2>$null | Select-Object -First 1)
    Write-Step "3/8 Bun installed: $BunVersion"
  }
} elseif (-not (Test-VersionAtLeast $BunVersion $MinBun)) {
  if ($DryRun) {
    Write-Skip "3/8 Bun $BunVersion is older than ${MinBun}: the plan asks to upgrade it (bun upgrade)"
  } else {
    Read-Yes "3/8 Bun $BunVersion is older than ${MinBun}. Upgrade it now with bun upgrade?"
    if ($script:Answer -eq "no") {
      Stop-Refused "Bun is still ${BunVersion}: cc-smart-dev-kit needs Bun $MinBun or newer" @("$Bun upgrade")
    }
    Write-Output "  upgrading Bun..."
    & $Bun upgrade
    if ($LASTEXITCODE -ne 0) {
      Stop-Failed "bun upgrade failed" @("$Bun upgrade")
    }
    $BunVersion = (& $Bun --version 2>$null | Select-Object -First 1)
    if (-not (Test-VersionAtLeast $BunVersion $MinBun)) {
      # A Bun from a package manager upgrades through that manager, not through itself.
      Stop-Failed "Bun is still $BunVersion after the upgrade: it may come from a package manager" @("scoop update bun", "winget upgrade Oven-sh.Bun", "$Bun upgrade")
    }
    Write-Step "3/8 Bun upgraded: $BunVersion"
  }
} else {
  Write-Step "3/8 Bun $BunVersion is new enough (the plugin needs $MinBun or newer)"
}

# --- 4. marketplaces -------------------------------------------------------------------
$Added = [System.Collections.Generic.List[string]]::new()
$Redeclared = [System.Collections.Generic.List[string]]::new()
# Before the first add: read access is what makes it possible at all (the same check step 2 runs
# when git could not read the repository). Only when this repository's marketplace is not added
# yet -- a machine that already has it added is installed as before.
if (-not $DryRun -and -not (Test-MarketplaceAdded $Marketplace)) { Assert-RepoReadAccess }
# `$entry`, never `$marketplace`: PowerShell variables are case-INSENSITIVE, and a loop
# variable spelled like the script's `$Marketplace` writes over it -- which is exactly how
# step 5 lost the marketplace's version on 0.4.2's Windows run (it printed "the plugin is
# updated" on a machine that was already current).
foreach ($entry in $MarketplacesToAdd) {
  $name = $entry.Name
  $source = $entry.Source
  # This repository's marketplace is added only when BOTH of Claude Code's records hold it:
  # known_marketplaces.json and the user settings, which is what `setup` reads. Only the
  # first: the same add runs again, and says it is a repair. The two companions stay on the
  # first record alone: `setup` reads nothing of them in the settings, and Claude Code
  # registers Anthropic's own marketplace by itself, which may leave no settings entry.
  $onDisk = $false
  if (Test-MarketplaceAdded $name) {
    if ($name -ne $Marketplace -or (Test-MarketplaceDeclared $name)) { continue }
    $onDisk = $true
  }
  if (-not $DryRun) {
    # Claude Code adds a marketplace over ssh by default, so a machine with no GitHub SSH key
    # (or a blocked port 22) is refused. The same marketplace over HTTPS works, and it lands
    # under the SAME name -- that name comes from the repository's own marketplace file, never
    # from the source -- so every step after this one finds it (live, 2026-10-17). One retry,
    # never a loop; any other failure is reported as it always was, with the command's own
    # words kept for whoever reads the line.
    $addOut = Get-CommandText { & $ClaudeBin plugin marketplace add $source }
    $addCode = $LASTEXITCODE
    if ($addCode -ne 0 -and (Test-SshRefused $addOut)) {
      $source = "https://github.com/${source}.git"
      Write-Skip "4/8 SSH to GitHub was refused, so the marketplace is added over HTTPS instead: $source"
      $addOut = Get-CommandText { & $ClaudeBin plugin marketplace add $source }
      $addCode = $LASTEXITCODE
    }
    if ($addCode -ne 0) {
      if (-not [string]::IsNullOrEmpty($addOut)) { [Console]::Error.WriteLine($addOut) }
      Stop-Failed "adding the marketplace $source failed" @("claude plugin marketplace add $source")
    }
    # The add is what writes the settings entry: if it is still missing, `setup` would stop on
    # it, so stop here with the command.
    if ($name -eq $Marketplace -and -not (Test-MarketplaceDeclared $name)) {
      Stop-Failed "the settings still do not list the $name marketplace after adding $source" @("claude plugin marketplace add $source")
    }
  }
  if ($onDisk) { $Redeclared.Add($source) } else { $Added.Add($source) }
}
if ($Added.Count -gt 0 -or $Redeclared.Count -gt 0) {
  if ($DryRun) {
    if ($Added.Count -gt 0) { Write-Skip "4/8 the plan adds: $($Added -join ', ')" }
    if ($Redeclared.Count -gt 0) { Write-Skip "4/8 the plan re-declares in your settings: $($Redeclared -join ', ')" }
  } else {
    if ($Added.Count -gt 0) { Write-Step "4/8 marketplaces added: $($Added -join ', ')" }
    if ($Redeclared.Count -gt 0) { Write-Step "4/8 re-declared in your settings: $($Redeclared -join ', ')" }
  }
} else {
  Write-Step "4/8 all three marketplaces are already added"
}

# --- 5. the plugin ---------------------------------------------------------------------
# The install line names the marketplace: `claude plugin install cc-smart-dev-kit` without
# `@cc-smart-dev-kit` can take the copy of the OLD marketplace, the one the move removes last
# (README, section Moving from anymodel).
#
# The marketplace's own copy is REFRESHED FIRST, before any version is compared. "Already
# installed, at the marketplace's version" is only true of a copy that is up to date: the first
# real run (2026-10-17) had the marketplace added hours earlier at 0.4.1, the installer compared
# the installed 0.4.1 with that stale clone's 0.4.1, saw them equal, updated nothing -- and then
# called a flag the installed 0.4.1 CLI did not have. `src/update/` runs the same two steps in
# the same order (`plugin marketplace update`, then `plugin update`); a PowerShell script cannot
# import that code, so this is its own copy of the order, and scripts/install.test.ts proves it.
if (-not $DryRun -and (Test-MarketplaceAdded $Marketplace)) {
  & $ClaudeBin plugin marketplace update $Marketplace
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "refreshing the $Marketplace marketplace failed" @("claude plugin marketplace update $Marketplace")
  }
}
$PluginDir = Get-InstalledPath
$HaveVersion = Get-InstalledVersion
$WantVersion = Get-MarketplaceVersion
if (-not [string]::IsNullOrEmpty($PluginDir) -and -not [string]::IsNullOrEmpty($WantVersion) -and $HaveVersion -eq $WantVersion) {
  Write-Step "5/8 the plugin is installed, at the marketplace's version ($WantVersion)"
} elseif ($DryRun) {
  Write-Skip "5/8 the plugin is $(if ([string]::IsNullOrEmpty($HaveVersion)) { "not installed" } else { $HaveVersion }), the marketplace's copy is $(if ([string]::IsNullOrEmpty($WantVersion)) { "not readable" } else { $WantVersion }): the plan installs or updates $Plugin at the user scope"
} elseif (-not [string]::IsNullOrEmpty($PluginDir)) {
  # An older copy: `claude plugin update` is the command that moves one version on, and the
  # plugin's own update runs exactly it (docs/claude-code-contract.md proves it). The line
  # names both versions: what moved, and -- when the marketplace's own copy cannot be read --
  # that it could not be.
  $before = Get-InstalledVersion
  & $ClaudeBin plugin update $Plugin --scope user
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "updating the plugin failed" @("claude plugin update $Plugin --scope user")
  }
  $PluginDir = Get-InstalledPath
  Write-Step "5/8 the plugin is updated ($before -> $(Get-InstalledVersion))"
} else {
  & $ClaudeBin plugin install $Plugin --scope user
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "installing the plugin failed" @("claude plugin install $Plugin --scope user")
  }
  $PluginDir = Get-InstalledPath
  if ([string]::IsNullOrEmpty($PluginDir)) {
    Stop-Failed "the install finished, but $InstalledPlugins does not name the plugin's folder" @("claude plugin list")
  }
  Write-Step "5/8 the plugin is installed ($(Get-InstalledVersion)): $PluginDir"
}
# Installed but turned off: enable it, or the plugin never loads. (A fresh install turns it
# on itself.)
if (-not $DryRun -and -not [string]::IsNullOrEmpty($PluginDir) -and -not (Test-PluginEnabled)) {
  & $ClaudeBin plugin enable $Plugin --scope user
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "enabling the plugin failed" @("claude plugin enable $Plugin --scope user")
  }
  Write-Step "5/8 the plugin is enabled"
}

# The plugin's own CLI, as every later call runs it. Set before the version check below, which is
# its first caller: set after it (as it once was), `Invoke-CliQuiet` ran a bare `bun version`.
$cliArgv = @("--no-env-file", "--config=$PluginDir\bunfig.toml", "$PluginDir\dist\cli.js")

# The CLI that is really installed now, asked its own version. A CLI older than this script does
# not have the options the later steps pass it (`--tavily-key-stdin`, `gateway check`), and the
# first real run died exactly there: the marketplace's clone had been stale, so the update never
# ran and a 0.4.1 CLI was called with a 0.4.2 flag. Stop with the two commands that fix it
# instead of calling one. A version that cannot be read stops it too: this script cannot promise
# an option a CLI it cannot see understands.
if (-not $DryRun -and -not [string]::IsNullOrEmpty($PluginDir)) {
  $CliVersion = ((Get-CommandText { Invoke-CliQuiet @("version") }).Trim() -split "\s+" | Select-Object -Last 1)
  if ([string]::IsNullOrEmpty($CliVersion)) {
    Stop-Failed "the installed cc-smart-dev-kit CLI's version could not be read: this installer cannot tell whether it has the options the later steps need" @("claude plugin marketplace update $Marketplace", "claude plugin update $Plugin --scope user")
  } elseif (-not (Test-VersionAtLeast $CliVersion $InstallerVersion)) {
    Stop-Failed "the installed cc-smart-dev-kit CLI is $CliVersion, older than this installer's ${InstallerVersion}: this installer would call options that version does not have" @("claude plugin marketplace update $Marketplace", "claude plugin update $Plugin --scope user")
  }
}

# --- 6. migrate, then setup ------------------------------------------------------------
if ([string]::IsNullOrEmpty($PluginDir) -and -not $DryRun) {
  Stop-Failed "the plugin's own folder is not in $InstalledPlugins" @("claude plugin install $Plugin --scope user")
}
if ($DryRun) {
  Write-Skip "6/8 migrate runs (it moves a machine with the old anymodel names, and says `"Nothing to move.`" on one without them), then setup; both ask their own questions on the console"
} else {
  Invoke-Cli @("migrate")
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "migrate failed" @((Get-PluginCommand @("migrate")))
  }
  Write-Step "6/8 migrate finished (nothing to move on a machine without the old anymodel names)"
  # `setup` after the move, always: the move installs no instructions and no launcher of its
  # own (README, section Moving from anymodel), and on a fresh machine setup is what puts
  # both in place.
  Invoke-Cli @("setup")
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "setup failed" @((Get-PluginCommand @("setup")))
  }
  Write-Step "6/8 setup finished"

  # The plugin's own MCP servers, when something else registered them first (live, 2026-10-17:
  # a project's own script had registered all four, setup left them alone as it must, and its
  # `!` line was never seen among the installer's output).
  Invoke-ForeignMcpPass "6/8"

  # The old plugin: `migrate` asks to remove it, but only when it is still installed and
  # only on a console. If it is still there, ask here -- the two commands go last in the
  # move on purpose (removing a marketplace uninstalls the plugins installed from it).
  if (Test-OldPluginInstalled) {
    Read-Yes "6/8 The old anymodel plugin is still installed. Remove it, and the old anymodel marketplace with it?"
    if ($script:Answer -eq "yes") {
      & $ClaudeBin plugin uninstall $OldPlugin --scope user
      if ($LASTEXITCODE -ne 0) {
        Stop-Failed "removing the old plugin failed" @("claude plugin uninstall $OldPlugin")
      }
      if (Test-MarketplaceAdded $OldMarketplace) {
        & $ClaudeBin plugin marketplace remove $OldMarketplace
        if ($LASTEXITCODE -ne 0) {
          Stop-Failed "removing the old marketplace failed" @("claude plugin marketplace remove $OldMarketplace")
        }
      }
      Write-Step "6/8 the old anymodel plugin and marketplace are removed"
    } else {
      Write-Skip "6/8 the old anymodel plugin was left in place: run ``claude plugin uninstall $OldPlugin``, then ``claude plugin marketplace remove $OldMarketplace``"
      $Left.Add("the old anymodel plugin: claude plugin uninstall $OldPlugin ; claude plugin marketplace remove $OldMarketplace")
    }
  }
}

# --- 7. what only the person has -------------------------------------------------------
# Every question is asked on the console, one at a time, and every one is skippable: a "no",
# or an empty answer, leaves that thing out and names the command that adds it later. A
# secret is read with no echo and reaches the plugin's own command on STDIN -- never on a
# command line, which this machine's process list and PowerShell's history would show.
if ($DryRun) {
  Write-Skip "7/8 the dry run asks nothing: the browser's token, the gateway's key and the Tavily key are asked in a real run"
} else {
  # The browser: `browser setup` finds Chrome, opens the Playwright extension's page in the
  # `claude-code` profile and prints the steps left for the person; the token is then read HERE,
  # with no echo, and reaches the command on stdin -- never as an argument, and never through a
  # question that could swallow the paste. (A person pasted a token as the answer to a yes/no
  # question once, the run walked on with no token file, and the browser never started: live,
  # 2026-10-17.)
  Read-Yes "7/8 Set up the browser (Playwright on your own Chrome)?"
  if ($script:Answer -eq "yes") {
    Invoke-Cli @("browser", "setup")
    if ($LASTEXITCODE -ne 0) { Stop-Failed "browser setup failed" @((Get-PluginCommand @("browser", "setup"))) }
    # (install.sh reads it the same way now: a PowerShell child cannot be given the console's
    # input stream, only the console, so the pipe is the way in on both.)
    Read-Secret "7/8 Paste the token from the extension's status page (it is not shown). Enter to skip:"
    $BrowserToken = $script:Answer
    $script:Answer = ""
    $saved = $false
    if (-not [string]::IsNullOrEmpty($BrowserToken)) {
      Send-SecretToCli $BrowserToken @("browser", "token")
      $BrowserToken = ""
      if ($LASTEXITCODE -ne 0) { Stop-Failed "the token was not saved" @((Get-PluginCommand @("browser", "token"))) }
      $saved = $true
    }
    if ($saved) {
      Write-Step "7/8 the browser's token is saved"
    } else {
      Write-Skip "7/8 the browser's token was skipped: run ``$(Get-PluginCommand @("browser", "token"))`` when you have it"
      $Left.Add("the browser's token: $(Get-PluginCommand @("browser", "token"))")
    }
  } else {
    Write-Skip "7/8 the browser was skipped: run ``$(Get-PluginCommand @("browser", "setup"))`` later"
    $Left.Add("the browser: $(Get-PluginCommand @("browser", "setup")), then $(Get-PluginCommand @("browser", "token"))")
  }

  # The gateway (optional): the local router and OmniRoute's key, under a per-user Scheduled
  # Task here. Every slot stays Claude and the gateway stays off until the person says otherwise
  # (D66): no word here suggests a model or a switch. Where it cannot run, the question is
  # skipped with the reason.
  if (-not (Test-GatewayServicePossible)) {
    Write-Skip "7/8 the gateway was skipped: its router runs as a per-user Scheduled Task, which needs PowerShell on this machine"
    $Left.Add("the gateway: README, section The AI gateway (its router needs PowerShell here)")
  } else {
    Read-Yes "7/8 Set up the AI gateway now (the local router and OmniRoute's key)?"
    if ($script:Answer -ne "yes") {
      Write-Skip "7/8 the gateway was skipped: README, section The AI gateway has its steps"
      $Left.Add("the gateway: $(Get-PluginCommand @("gateway", "setup", "--backend-key-stdin", "omniroute"))")
    } else {
      # A router already installed here may be running: `gateway setup` restarts it, and a
      # restart cuts every answer in flight. The command asks that question itself only on a
      # console, and this step's stdin is a pipe or nothing -- so the person is asked here,
      # and --yes carries their answer to the command.
      $RestartFlag = @()
      $gatewayGo = $true
      if (Test-Path $RouterCopy) {
        Read-Yes "7/8 A router is already installed here: setup restarts it, and running Claude Code sessions fail until you restart them. Go on?"
        if ($script:Answer -eq "no") { $gatewayGo = $false } else { $RestartFlag = @("--yes") }
      }
      if (-not $gatewayGo) {
        Write-Skip "7/8 the gateway was left as it is: run ``$(Get-PluginCommand @("gateway", "setup", "--yes"))`` when you are ready"
        $Left.Add("the gateway (its router was not restarted): $(Get-PluginCommand @("gateway", "setup", "--yes"))")
      } else {
        # Is the gateway working ALREADY? The plugin's own read-only check answers it, and that
        # is what decides whether anybody is asked for a key at all:
        #   0 it works (the backend accepts the key in gateway.json)
        #   1 there is no OmniRoute key yet, and an OmniRoute answers: setup can MAKE one from
        #     the dashboard password
        #   4 the key there is one OmniRoute refuses: a new API key is what fixes it
        #   3 it could not be judged (no OmniRoute answers, or the config cannot be read)
        # The first real run asked for a key anyway on a machine whose gateway worked
        # (2026-10-17), a provider key was pasted over the router's own, and every affordable
        # subagent fell back to Claude. That is why this check comes first.
        $GatewayCheckOut = Get-CommandText { Invoke-CliQuiet @("gateway", "check") }
        $GatewayCheckCode = $LASTEXITCODE
        $gatewaySaved = $false
        if ($GatewayCheckCode -eq 0) {
          Write-Skip "7/8 the gateway already works, so no key is asked: $GatewayCheckOut"
        } elseif ($GatewayCheckCode -eq 1 -or $GatewayCheckCode -eq 4) {
          # The key question, asked at most twice: a key the backend refuses is refused by
          # `gateway setup` itself (it tests the key before it saves it, and keeps the old one),
          # and its own line on the console says why. Enter skips it.
          $gatewayTries = 0
          while ($gatewayTries -lt 2) {
            if ($GatewayCheckCode -eq 1) {
              Read-Secret "7/8 Paste your OmniRoute dashboard password, and setup makes the router's key itself (it is never stored, and never shown). Enter to skip:"
            } else {
              Read-Secret "7/8 Paste the OmniRoute API key the router uses (OmniRoute's dashboard, its API keys page; not your Ollama key). Enter to skip:"
            }
            $GatewayKey = $script:Answer
            $script:Answer = ""
            if ([string]::IsNullOrEmpty($GatewayKey)) { break }
            # The secret goes in on stdin, never as an argument.
            if ($GatewayCheckCode -eq 1) {
              Send-SecretToCli $GatewayKey (@("gateway", "setup", "--omniroute-password-stdin", "--save-unchecked") + $RestartFlag)
            } else {
              Send-SecretToCli $GatewayKey (@("gateway", "setup", "--backend-key-stdin", "omniroute") + $RestartFlag)
            }
            $gatewayCode = $LASTEXITCODE
            $GatewayKey = ""
            if ($gatewayCode -eq 0) { $gatewaySaved = $true; break }
            $gatewayTries = $gatewayTries + 1
            if ($gatewayTries -lt 2) {
              [Console]::Error.WriteLine("  That was not saved: the line above says why, and the gateway keeps the key it had. README, section The AI gateway, says which key OmniRoute wants. One more try.")
            }
          }
          if (-not $gatewaySaved) {
            Write-Skip "7/8 the gateway keeps the key it had: give it a new one with ``$(Get-PluginCommand @("gateway", "setup", "--backend-key-stdin", "omniroute"))``, or let setup make one with ``$(Get-PluginCommand @("gateway", "setup", "--omniroute-password"))``"
            $Left.Add("the gateway's key: README, section The AI gateway, says which key OmniRoute wants, then $(Get-PluginCommand @("gateway", "setup", "--backend-key-stdin", "omniroute"))")
          }
        } else {
          # 3, or anything this script does not know: ask nothing, and say what the check said.
          # A machine with no OmniRoute at all cannot use the gateway yet, so the item goes to
          # the list at the end (live, 2026-10-17).
          Write-Skip "7/8 the gateway is left as it is: $GatewayCheckOut"
          $Left.Add("the gateway: README, section The AI gateway, says how to install and run OmniRoute, then $(Get-PluginCommand @("gateway", "setup", "--omniroute-password"))")
        }
        # The router's copy and its service are refreshed whenever no key was saved: a machine
        # that has a key keeps it (`--no-backend-key` changes no key).
        if ($gatewaySaved) {
          Write-Step "7/8 the gateway is set up: the router and OmniRoute's key are ready"
        } else {
          Invoke-CliQuiet (@("gateway", "setup", "--no-backend-key") + $RestartFlag)
          if ($LASTEXITCODE -ne 0) {
            Stop-Failed "gateway setup failed" @((Get-PluginCommand @("gateway", "setup", "--no-backend-key")))
          }
          if ($GatewayCheckCode -eq 0) {
            Write-Step "7/8 the gateway is up to date: the router and OmniRoute's key are ready"
          } else {
            Write-Skip "7/8 the router's copy and service are refreshed, and the gateway's key is untouched"
          }
        }
      }
    }
  }

  # The Tavily key (optional): setup takes it on stdin, saves it as a file only this account can
  # read and copies it into your settings -- the plugin's own command owns every secret file, and
  # this script writes none. NOT asked when a key is already there for setup to read: the
  # variable in this environment, the key file, or the settings. A person whose project already
  # uses a Tavily MCP server must not be asked for a key they have (live, 2026-10-17).
  if (-not [string]::IsNullOrEmpty($env:TAVILY_API_KEY)) {
    Write-Skip "7/8 Tavily: using TAVILY_API_KEY from your environment (nothing is asked, nothing is written)"
  } elseif ((Test-Path $TavilyKeyFile) -and (Get-Item -Path $TavilyKeyFile).Length -gt 0) {
    Write-Skip "7/8 Tavily: using the key already in ``$TavilyKeyFile`` (nothing is asked)"
  } elseif (-not [string]::IsNullOrEmpty((Get-JsonField $SettingsFile "env.TAVILY_API_KEY"))) {
    Write-Skip "7/8 Tavily: using the TAVILY_API_KEY already in ``$SettingsFile`` (nothing is asked)"
  } else {
    Read-Yes "7/8 Add your Tavily key now (the tavily-websearch MCP server)?"
    if ($script:Answer -eq "yes") {
      Read-Secret "7/8 Paste the Tavily API key (Enter to skip):"
      $TavilyKey = $script:Answer
      $script:Answer = ""
      if (-not [string]::IsNullOrEmpty($TavilyKey)) {
        Send-SecretToCli $TavilyKey @("setup", "--tavily-key-stdin")
        $TavilyKey = ""
        if ($LASTEXITCODE -ne 0) {
          Stop-Failed "saving the Tavily key failed" @((Get-PluginCommand @("setup", "--tavily-key-stdin")))
        }
        Write-Step "7/8 the Tavily key is saved"
      } else {
        Write-Skip "7/8 the Tavily key was skipped: write it to the key file, then run ``$(Get-PluginCommand @("setup"))``"
        $Left.Add("the Tavily key: README, section MCP servers says where it goes, then $(Get-PluginCommand @("setup"))")
      }
    } else {
      Write-Skip "7/8 the Tavily key was skipped: README, section MCP servers says where it goes"
      $Left.Add("the Tavily key: README, section MCP servers says where it goes, then $(Get-PluginCommand @("setup"))")
    }
  }

  # Again, now that a Tavily key may have arrived: what the plugin registers changed, and a
  # `tavily-websearch` of someone else's must not go on shadowing it. A name already asked
  # about in step 6 is not asked again (Invoke-ForeignMcpPass).
  Invoke-ForeignMcpPass "7/8"
}

# --- 8. doctor, what is left, and the two closing lines --------------------------------
if ($DryRun) {
  Write-Skip "8/8 the plan ends with ``doctor``"
  Write-Output ""
  Write-Output "Dry run: nothing was written, nothing ran, and no network was reached."
  exit 0
}

# The report as JSON (DoctorReport, src/cli/doctor.ts), read for its failures: a person reads
# the step line and the list below, and `doctor` itself shows every check. Never its text for a
# person: that has groups, folds and wraps, and its marks change with the console. STDOUT only:
# a stderr line must not reach ConvertFrom-Json.
if (Test-Path $Launcher) {
  $doctorJson = Get-CommandStdout { & $Launcher doctor --json }
} else {
  $doctorJson = Get-CommandStdout { Invoke-CliQuiet @("doctor", "--json") }
}
$doctorCode = $LASTEXITCODE
$doctorLeft = [System.Collections.Generic.List[object]]::new()
try {
  foreach ($group in @((ConvertFrom-Json -InputObject $doctorJson).groups)) {
    foreach ($check in @($group.checks | Where-Object { $_.status -eq "fail" })) { $doctorLeft.Add($check) }
  }
} catch {
  # Not JSON (doctor failed before its report): the line below says so.
  $doctorLeft.Clear()
}
if ($doctorCode -ne 0 -and $doctorLeft.Count -eq 0) {
  $doctorLeft.Add([pscustomobject]@{ text = "doctor did not finish its report"; fix = "run ``$(Get-PluginCommand @("doctor"))`` to see why" })
}
if ($doctorCode -eq 0) {
  Write-Step "8/8 doctor: every check passed"
} else {
  [Console]::Error.WriteLine("[x] 8/8 doctor found what is left (the list below; ``$(Get-PluginCommand @("doctor"))`` shows every check)")
}

Write-Output ""
Write-Output "Restart every Claude Code session: they load the plugin when they start."
Write-Output "``cc-smart-dev-kit portal`` opens the portal in your own terminal (it prints a link with a one-time token)."

# What is left: the items this run skipped, then each of doctor's failures with its fix.
if ($Left.Count -gt 0 -or $doctorLeft.Count -gt 0) {
  Write-Output ""
  Write-Output "What is left:"
  foreach ($line in $Left) { Write-Output "  - $line" }
  foreach ($check in $doctorLeft) {
    Write-Output "  [x] $($check.text)"
    if ($check.fix) { Write-Output "    Fix: $($check.fix)" }
  }
}

if ($doctorCode -ne 0) { exit 3 }
exit 0
