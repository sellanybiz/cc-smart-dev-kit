# cc-smart-dev-kit's installer for native Windows (PowerShell 5.1 and pwsh): one command
# that does everything the machine can do by itself, and asks the person only for what only
# they have. install.sh is its macOS and Linux twin: same steps, same words, same exit codes.
#
# HOW IT IS STARTED — the README has both lines, the first one for a private repository:
#
#   & ([scriptblock]::Create((gh api repos/<owner>/cc-smart-dev-kit/contents/install.ps1 `
#       -H "Accept: application/vnd.github.raw" | Out-String))) <owner>/cc-smart-dev-kit
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/<owner>/cc-smart-dev-kit/main/install.ps1))) <owner>/cc-smart-dev-kit
#
# WHY THE REPOSITORY IS AN ARGUMENT: the plugin names no owner anywhere (its own rule), so
# the script cannot carry one. The argument is `<owner>/<name>`, the same source `claude
# plugin marketplace add` takes. With no argument the script reads CC_SMART_DEV_KIT_REPO;
# with neither it prints one usage line and stops.
#
# WHY EVERY QUESTION READS THE CONSOLE: run this way, the script's input is a script block
# or a pipeline, and a question read from there would eat the script. Every question goes
# through Read-Host (or Read-Host -AsSecureString for a secret, which is never echoed), and
# the commands it runs get the console as their input, so they ask their own questions
# there. CC_SMART_DEV_KIT_INSTALL_TTY points the questions at a file of answers instead; it
# is for the tests, not for people.
#
# WHAT IT NEVER DOES: it never passes a secret on a command line (a command line is
# readable by every process on the machine and lands in PowerShell's history) and never
# writes a secret file itself — the plugin's own commands own that. It installs or upgrades
# nothing without asking. It refuses to run inside a Claude Code session, where it could
# replace the router that session's own model traffic goes through.
#
# THE STEPS, IN ORDER, each one line (a second run skips what is already done):
#
#   1. refuse inside a Claude Code session (CLAUDECODE, as `migrate` tests it);
#   2. `claude` on PATH, and git can read the repository;
#   3. Bun present and at least MinBun (asked before it installs or upgrades one);
#   4. the three marketplaces added (this repository's, and the two companions');
#   5. the plugin installed at the user scope, skipped when it is already there;
#   6. `migrate` on a machine that still has the old anymodel names, else `setup`;
#   7. the three things only the person has: the browser's token, the gateway's key, the
#      Tavily key — each asked on the console, each skippable, never echoed, never printed;
#   8. `doctor`, then the two closing lines.
#
# EXIT CODES: 0 done; 1 a step failed (the line names the command that retries it; running
# the installer again goes on from there); 2 refused (inside a Claude Code session, a
# question answered no, or no console to ask on).
#
# -DryRun prints the plan for this machine and changes nothing: it runs no `claude`, no
# setup, writes no file and reaches no network. It still reads this machine's local facts
# (which commands exist, their versions, what is already installed).

param(
  [Parameter(Position = 0)][string]$Repo = "",
  [switch]$DryRun
)

# The oldest Bun cc-smart-dev-kit runs on: MIN_BUN in src/build-info/bun.ts, which
# package.json's `engines.bun` and CI's setup-bun also follow. A test keeps the two equal
# (scripts/install.test.ts).
$MinBun = "1.4.3"

# The names this repository declares: the marketplace in .claude-plugin/marketplace.json
# and the plugin id in plugin/.claude-plugin/plugin.json. `claude plugin install` needs
# both halves of the id.
$Marketplace = "cc-smart-dev-kit"
$Plugin = "cc-smart-dev-kit@cc-smart-dev-kit"

function Write-Usage {
  Write-Output "usage: .\install.ps1 <owner>/<repo>   (or set CC_SMART_DEV_KIT_REPO=<owner>/<repo>)"
}

# ─── the repository argument ────────────────────────────────────────────────────────────
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

# ─── the machine's paths (the same layout as macOS and Linux, under %USERPROFILE%) ──────
# HOME first, then PowerShell's own: the plugin's paths come from the environment (its own
# rule), Git Bash exports HOME, and a test can point a run at a folder of its own.
$HomeDir = if (-not [string]::IsNullOrEmpty($env:HOME)) { $env:HOME } else { $HOME }
$ClaudeDir = if ([string]::IsNullOrEmpty($env:CLAUDE_CONFIG_DIR)) { Join-Path $HomeDir ".claude" } else { $env:CLAUDE_CONFIG_DIR }
$PluginsDir = Join-Path $ClaudeDir "plugins"
$KnownMarketplaces = Join-Path $PluginsDir "known_marketplaces.json"
$InstalledPlugins = Join-Path $PluginsDir "installed_plugins.json"
$BinDir = Join-Path $HomeDir ".local\bin"
# Windows runs the .cmd launcher from PowerShell and cmd; the extensionless one is for Git
# Bash, which the plugin's `sh` parts need (docs/windows-setup.md).
$Launcher = Join-Path $BinDir "cc-smart-dev-kit.cmd"

# ─── output ────────────────────────────────────────────────────────────────────────────
function Write-Step([string]$Line) { Write-Output "✓ $Line" }
function Write-Skip([string]$Line) { Write-Output "· $Line" }

# A step that failed: what failed, and the command that retries just that step.
function Stop-Failed([string]$What, [string[]]$Retry) {
  [Console]::Error.WriteLine("✗ $What")
  [Console]::Error.WriteLine("  Retry just that step with:")
  foreach ($command in $Retry) { [Console]::Error.WriteLine("    $command") }
  [Console]::Error.WriteLine("  Then run this installer again: it goes on from there.")
  exit 1
}

# Refused: the machine is not touched. 2, so a script around this installer can tell a
# refusal from a failure.
function Stop-Refused([string]$Why, [string[]]$Retry) {
  [Console]::Error.WriteLine("✗ $Why")
  if ($Retry.Count -gt 0) {
    [Console]::Error.WriteLine("  Run this, then run the installer again:")
    foreach ($command in $Retry) { [Console]::Error.WriteLine("    $command") }
  }
  exit 2
}

# ─── the console ───────────────────────────────────────────────────────────────────────
# Every question writes its answer into $script:Answer (never into a captured expression:
# the prompt would come with it). A function's own `$Answer = …` would stay inside that
# function, and the question would look unanswered.
$script:Answer = ""
$script:Answers = $null
$script:AnswerIndex = 0

# Opens the console: the answers file when CC_SMART_DEV_KIT_INSTALL_TTY names one (the
# tests), else the console itself. Called just before the first question, so -DryRun and a
# machine that needs nothing asked work with no console at all.
function Assert-Console {
  if (-not [string]::IsNullOrEmpty($env:CC_SMART_DEV_KIT_INSTALL_TTY)) {
    if (-not (Test-Path $env:CC_SMART_DEV_KIT_INSTALL_TTY)) {
      Stop-Refused "no console to ask on ($env:CC_SMART_DEV_KIT_INSTALL_TTY is not there): run this installer in your own terminal" @(".\install.ps1 $Repo")
    }
    if ($null -eq $script:Answers) {
      $script:Answers = [System.IO.File]::ReadAllLines($env:CC_SMART_DEV_KIT_INSTALL_TTY)
    }
    return
  }
  if ($Host.Name -eq "ServerRemoteHost" -or -not [Environment]::UserInteractive) {
    Stop-Refused "no console to ask on: run this installer in your own terminal" @(".\install.ps1 $Repo")
  }
}

# One line from the console; $Answer is empty when the answers run out.
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

# A yes/no question; $Answer is "no" unless the person writes yes.
function Read-Yes([string]$Question) {
  if ($null -ne $script:Answers) {
    Write-Output "$Question [y/N] "
    Read-OneLine
  } else {
    $script:Answer = [string](Read-Host -Prompt "$Question [y/N]")
  }
  if ($script:Answer -match "^(y|yes)$") { $script:Answer = "yes" } else { $script:Answer = "no" }
}

# A secret: never echoed, never printed, never on a command line.
function Read-Secret([string]$Prompt) {
  if ($null -ne $script:Answers) {
    Write-Output "$Prompt "
    Read-OneLine
    return
  }
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $script:Answer = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ─── reading this machine's state ──────────────────────────────────────────────────────
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
  $entries = $data.plugins.PSObject.Properties["$Plugin"]
  if ($null -eq $entries) { return "" }
  foreach ($entry in @($entries.Value)) {
    if ($entry.scope -eq "user") { return [string]$entry.installPath }
  }
  return ""
}

function Get-InstalledVersion {
  if (-not (Test-Path $InstalledPlugins)) { return "" }
  try { $data = Get-Content -Raw -Path $InstalledPlugins | ConvertFrom-Json } catch { return "" }
  $entries = $data.plugins.PSObject.Properties["$Plugin"]
  if ($null -eq $entries) { return "" }
  foreach ($entry in @($entries.Value)) {
    if ($entry.scope -eq "user") { return [string]$entry.version }
  }
  return ""
}

# The version the marketplace's own copy declares: what `claude plugin install` would put
# in place now. `<installLocation>/plugin` is the plugin's folder inside this repository
# (marketplace.json's `source`), so the manifest sits there.
function Get-MarketplaceVersion {
  $location = Get-JsonField $KnownMarketplaces "$Marketplace.installLocation"
  if ([string]::IsNullOrEmpty($location)) { return "" }
  return Get-JsonField (Join-Path $location "plugin\.claude-plugin\plugin.json") "version"
}

# "Already added" is Claude Code's own record, known_marketplaces.json, keyed by the
# marketplace's name — proved live: a source already added under another name (the rename
# from anymodel) was NOT reused, and a second marketplace was made instead, so only the
# name answers the question. This is the file the plugin's own `marketplaceAdded` reads.
function Test-MarketplaceAdded([string]$Name) {
  return Test-JsonKey $KnownMarketplaces $Name
}

# True when this machine still has the old anymodel names, so `migrate` is the command to
# run and `setup` is not (README § Moving from anymodel lists every one of them; the
# folders and the launcher are what a move rewrites).
function Test-OldNamesPresent {
  foreach ($path in @(
      (Join-Path $HomeDir ".config\anymodel"),
      (Join-Path $HomeDir ".local\share\anymodel"),
      (Join-Path $HomeDir ".local\state\anymodel"),
      (Join-Path $ClaudeDir "anymodel"),
      (Join-Path $BinDir "anymodel")
    )) {
    if (Test-Path $path) { return $true }
  }
  if (-not (Test-Path $InstalledPlugins)) { return $false }
  try { $data = Get-Content -Raw -Path $InstalledPlugins | ConvertFrom-Json } catch { return $false }
  return $null -ne $data.plugins.PSObject.Properties["anymodel@anymodel"]
}

# True when version $1 is at least $2. A numeric compare, field by field, so 1.10.0 is
# newer than 1.4.3. A pre-release of the minimum itself (1.4.3-canary.1) counts as older,
# exactly as `bunTooOld` in src/build-info/bun.ts counts it: it may be built before the fix.
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

# Runs the plugin's own CLI with this machine's bun, in the exact form README § Install
# uses (both flags matter: Bun would otherwise read the folder's own `.env` files and its
# `bunfig.toml`).
function Invoke-Cli([string[]]$CliArgs) {
  & $Bun --no-env-file "--config=$PluginDir\bunfig.toml" "$PluginDir\dist\cli.js" @CliArgs
}

# The line that retries one of the plugin's own commands, once it is installed: the
# launcher when setup has put it in place, else the exact `bun --no-env-file …` form.
function Get-PluginCommand([string[]]$CliArgs) {
  $joined = $CliArgs -join " "
  if (Test-Path $Launcher) { return "$Launcher $joined" }
  return "bun --no-env-file --config=$(Get-ShellWord "$PluginDir\bunfig.toml") $(Get-ShellWord "$PluginDir\dist\cli.js") $joined"
}

# ─── the machine, before anything changes ──────────────────────────────────────────────
# The Bun this script will use, filled in by step 3 (nothing is run before the refusal in
# step 1: inside a Claude Code session this script must do nothing at all).
$Bun = ""
$BunVersion = ""

if ($DryRun) {
  Write-Output "cc-smart-dev-kit installer: dry run, the plan for this machine. Nothing is changed."
  Write-Output "  repository:   $Repo"
  Write-Output "  marketplaces: $Repo, thedotmack/claude-mem, anthropics/claude-plugins-official"
  Write-Output "  plugin:       $Plugin, at the user scope"
}

# ─── 1. inside a Claude Code session ───────────────────────────────────────────────────
if (-not [string]::IsNullOrEmpty($env:CLAUDECODE)) {
  Stop-Refused "this installer cannot run inside a Claude Code session: it may replace the router this session's own model traffic goes through." @("open your own terminal and run the installer there")
}
Write-Step "1/8 not inside a Claude Code session"

# ─── 2. claude, and git can read the repository ────────────────────────────────────────
$ClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue
if ($null -eq $ClaudeCommand) {
  Stop-Failed "claude is not on PATH: the plugin is installed with Claude Code's own commands" @("install Claude Code: https://code.claude.com")
}
$ClaudeBin = $ClaudeCommand.Source

# A private repository needs the person's git credentials. The check never waits for one
# (GIT_TERMINAL_PROMPT=0, and ssh in BatchMode): a prompt in the middle of an installer is
# worse than a line saying how to fix it. SSH first, then HTTPS — the order Claude Code's
# own marketplace clone uses.
function Test-GitCanRead {
  if ($DryRun) { return $true }
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GIT_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=8"
  & git ls-remote "git@github.com:$Repo.git" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return $true }
  & git ls-remote "https://github.com/$Repo.git" 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}
if (Test-GitCanRead) {
  if ($DryRun) {
    Write-Skip "2/8 claude found: $ClaudeBin; the dry run reaches no network, so git is not checked"
  } else {
    Write-Step "2/8 claude found: $ClaudeBin, and git can read $Repo"
  }
} else {
  Stop-Failed "git cannot read $Repo: a private repository needs your git credentials" @("gh auth login", "gh auth setup-git")
}

# ─── 3. Bun ────────────────────────────────────────────────────────────────────────────
$BunCommand = Get-Command bun -ErrorAction SilentlyContinue
if ($null -ne $BunCommand) { $Bun = $BunCommand.Source }
if (-not [string]::IsNullOrEmpty($Bun)) {
  $BunVersion = (& $Bun --version 2>$null | Select-Object -First 1)
}
if ([string]::IsNullOrEmpty($Bun)) {
  if ($DryRun) {
    Write-Skip "3/8 Bun is not installed: the plan asks to install it (the plugin needs $MinBun or newer)"
  } else {
    Assert-Console
    Read-Yes "3/8 Bun is not installed. Install it with Bun's own PowerShell installer (powershell -c `"irm bun.sh/install.ps1 | iex`")?"
    if ($script:Answer -eq "no") {
      Stop-Refused "Bun was not installed: cc-smart-dev-kit needs Bun $MinBun or newer" @("powershell -c `"irm bun.sh/install.ps1 | iex`"")
    }
    Write-Output "  installing Bun (https://bun.sh/docs/installation)…"
    & powershell -c "irm bun.sh/install.ps1 | iex"
    if ($LASTEXITCODE -ne 0) {
      Stop-Failed "the Bun installer failed" @("powershell -c `"irm bun.sh/install.ps1 | iex`"")
    }
    $BunCommand = Get-Command bun -ErrorAction SilentlyContinue
    if ($null -ne $BunCommand) {
      $Bun = $BunCommand.Source
    } elseif (Test-Path (Join-Path $HomeDir ".bun\bin\bun.exe")) {
      $Bun = Join-Path $HomeDir ".bun\bin\bun.exe"
    } else {
      Stop-Failed "Bun was installed, but it is not on PATH and not at ~/.bun/bin/bun.exe" @('$env:PATH = "$HOME\.bun\bin;$env:PATH"')
    }
    $BunVersion = (& $Bun --version 2>$null | Select-Object -First 1)
    Write-Step "3/8 Bun installed: $BunVersion"
  }
} elseif (-not (Test-VersionAtLeast $BunVersion $MinBun)) {
  if ($DryRun) {
    Write-Skip "3/8 Bun $BunVersion is older than $MinBun: the plan asks to upgrade it (bun upgrade)"
  } else {
    Assert-Console
    Read-Yes "3/8 Bun $BunVersion is older than $MinBun. Upgrade it now with bun upgrade?"
    if ($script:Answer -eq "no") {
      Stop-Refused "Bun is still $BunVersion: cc-smart-dev-kit needs Bun $MinBun or newer" @("$Bun upgrade")
    }
    Write-Output "  upgrading Bun…"
    & $Bun upgrade
    if ($LASTEXITCODE -ne 0) {
      Stop-Failed "bun upgrade failed" @("$Bun upgrade")
    }
    $BunVersion = (& $Bun --version 2>$null | Select-Object -First 1)
    if (-not (Test-VersionAtLeast $BunVersion $MinBun)) {
      Stop-Failed "Bun is still $BunVersion after the upgrade: it may come from a package manager (scoop update bun)" @("$Bun upgrade")
    }
    Write-Step "3/8 Bun upgraded: $BunVersion"
  }
} else {
  Write-Step "3/8 Bun $BunVersion is new enough (the plugin needs $MinBun or newer)"
}

# ─── 4. marketplaces ───────────────────────────────────────────────────────────────────
$Added = @()
foreach ($pair in @(
    @($Marketplace, $Repo),
    @("thedotmack", "thedotmack/claude-mem"),
    @("claude-plugins-official", "anthropics/claude-plugins-official")
  )) {
  $name = $pair[0]
  $source = $pair[1]
  if (Test-MarketplaceAdded $name) { continue }
  if (-not $DryRun) {
    & $ClaudeBin plugin marketplace add $source
    if ($LASTEXITCODE -ne 0) {
      Stop-Failed "adding the marketplace $source failed" @("claude plugin marketplace add $source")
    }
  }
  $Added += $source
}
if ($Added.Count -gt 0) {
  if ($DryRun) {
    Write-Skip "4/8 the plan adds: $($Added -join ', ')"
  } else {
    Write-Step "4/8 marketplaces added: $($Added -join ', ')"
  }
} else {
  Write-Step "4/8 all three marketplaces are already added"
}

# ─── 5. the plugin ─────────────────────────────────────────────────────────────────────
# The install line names the marketplace: `claude plugin install cc-smart-dev-kit` without
# `@cc-smart-dev-kit` can take the copy of the OLD marketplace, the one the move removes
# last (README § Moving from anymodel).
$PluginDir = Get-InstalledPath
$HaveVersion = Get-InstalledVersion
$WantVersion = Get-MarketplaceVersion
if (-not [string]::IsNullOrEmpty($PluginDir) -and -not [string]::IsNullOrEmpty($WantVersion) -and $HaveVersion -eq $WantVersion) {
  Write-Step "5/8 the plugin is installed, at the marketplace's version ($WantVersion)"
} elseif ($DryRun) {
  Write-Skip "5/8 the plugin is $(if ([string]::IsNullOrEmpty($HaveVersion)) { "not installed" } else { $HaveVersion }): the plan installs $Plugin at the user scope"
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

# ─── 6. migrate on an old machine, setup on a new one ──────────────────────────────────
if ([string]::IsNullOrEmpty($PluginDir) -and -not $DryRun) {
  Stop-Failed "the plugin's own folder is not in $InstalledPlugins" @("claude plugin install $Plugin --scope user")
}

if (Test-OldNamesPresent) {
  $FirstCommand = "migrate"
  $FirstWhy = "this machine still has the old anymodel names"
} else {
  $FirstCommand = "setup"
  $FirstWhy = "a new machine"
}
if ($DryRun) {
  Write-Skip "6/8 $FirstCommand runs ($FirstWhy); it asks its own questions on the console"
} else {
  # The console is what it reads its own questions from. Both commands ask everything
  # before they write anything.
  Assert-Console
  Invoke-Cli @($FirstCommand)
  if ($LASTEXITCODE -ne 0) {
    Stop-Failed "$FirstCommand failed" @((Get-PluginCommand @($FirstCommand)))
  }
  Write-Step "6/8 $FirstCommand finished ($FirstWhy)"
}

# ─── 7. what only the person has ───────────────────────────────────────────────────────
# Every question is asked on the console, one at a time, and every one is skippable: a
# "no", or an empty answer, leaves that thing out and names the command that adds it later.
# A secret is read with no echo and reaches the plugin's own command on STDIN — never on a
# command line, which this machine's process list and PowerShell's history would show.
if ($DryRun) {
  Write-Skip "7/8 the dry run asks nothing: the browser's token, the gateway's key and the Tavily key are asked in a real run"
} else {
  Assert-Console

  # The browser: `browser setup` finds Chrome, opens the Playwright extension's page in the
  # `claude-code` profile and prints the steps left for the person; `browser token` then
  # saves the token that page shows.
  Read-Yes "7/8 Set up the browser (Playwright on your own Chrome)?"
  if ($script:Answer -eq "yes") {
    Invoke-Cli @("browser", "setup")
    if ($LASTEXITCODE -ne 0) { Stop-Failed "browser setup failed" @((Get-PluginCommand @("browser", "setup"))) }
    Read-Yes "7/8 Paste the extension's token now (the extension's status page shows it)?"
    if ($script:Answer -eq "yes") {
      # The prompt, the invisible typing and the token's shape check are the command's own.
      Invoke-Cli @("browser", "token")
      if ($LASTEXITCODE -ne 0) { Stop-Failed "the token was not saved" @((Get-PluginCommand @("browser", "token"))) }
      Write-Step "7/8 the browser's token is saved"
    } else {
      Write-Skip "7/8 the browser's token was skipped: run ``cc-smart-dev-kit browser token`` when you have it"
    }
  } else {
    Write-Skip "7/8 the browser was skipped: run ``cc-smart-dev-kit browser setup`` later"
  }

  # The gateway (optional): its router answers the affordable model slots. Its key arrives
  # on stdin (`--backend-key-stdin`, the README's own line) and never as an argument; with
  # no key, every slot answers on Claude until one is added.
  Read-Yes "7/8 Set up the AI gateway now (affordable models for the haiku and sonnet subagents)?"
  if ($script:Answer -eq "yes") {
    Read-Secret "7/8 Paste the OmniRoute API key (Enter to skip: every slot then answers on Claude):"
    $GatewayKey = $script:Answer
    if (-not [string]::IsNullOrEmpty($GatewayKey)) {
      $GatewayKey | & $Bun --no-env-file "--config=$PluginDir\bunfig.toml" "$PluginDir\dist\cli.js" gateway setup --backend-key-stdin omniroute
      $GatewayKey = ""
      if ($LASTEXITCODE -ne 0) {
        Stop-Failed "gateway setup failed" @("cc-smart-dev-kit gateway setup --backend-key-stdin omniroute < key-file")
      }
    } else {
      Invoke-Cli @("gateway", "setup", "--no-backend-key")
      if ($LASTEXITCODE -ne 0) { Stop-Failed "gateway setup failed" @("cc-smart-dev-kit gateway setup --no-backend-key") }
    }
    Write-Step "7/8 the gateway is set up: turn it on with ``cc-smart-dev-kit gateway on`` when you want it"
  } else {
    Write-Skip "7/8 the gateway was skipped: README § The AI gateway has its steps"
  }

  # The Tavily key (optional): setup takes it on stdin, saves it as a file only this
  # account can read and copies it into your settings — the plugin's own command owns every
  # secret file, and this script writes none.
  Read-Yes "7/8 Add your Tavily key now (the tavily-websearch MCP server)?"
  if ($script:Answer -eq "yes") {
    Read-Secret "7/8 Paste the Tavily API key (Enter to skip):"
    $TavilyKey = $script:Answer
    if (-not [string]::IsNullOrEmpty($TavilyKey)) {
      $TavilyKey | & $Bun --no-env-file "--config=$PluginDir\bunfig.toml" "$PluginDir\dist\cli.js" setup --tavily-key-stdin
      $TavilyKey = ""
      if ($LASTEXITCODE -ne 0) {
        Stop-Failed "saving the Tavily key failed" @("cc-smart-dev-kit setup --tavily-key-stdin < key-file")
      }
      Write-Step "7/8 the Tavily key is saved"
    } else {
      Write-Skip "7/8 the Tavily key was skipped: write it to the key file, then run ``cc-smart-dev-kit setup``"
    }
  } else {
    Write-Skip "7/8 the Tavily key was skipped: README § MCP servers says where it goes"
  }
}

# ─── 8. doctor, and the two closing lines ──────────────────────────────────────────────
if ($DryRun) {
  Write-Skip "8/8 the plan ends with ``cc-smart-dev-kit doctor``"
  Write-Output ""
  Write-Output "Dry run: nothing was written, nothing ran, and no network was reached."
  exit 0
}

$DoctorFailed = $false
if (Test-Path $Launcher) {
  & $Launcher doctor
  if ($LASTEXITCODE -ne 0) { $DoctorFailed = $true }
  $DoctorCommand = "$Launcher doctor"
} else {
  Invoke-Cli @("doctor")
  if ($LASTEXITCODE -ne 0) { $DoctorFailed = $true }
  $DoctorCommand = Get-PluginCommand @("doctor")
}
if ($DoctorFailed) {
  [Console]::Error.WriteLine("✗ doctor found a problem (its lines above say which)")
  [Console]::Error.WriteLine("  Run it again once that is fixed:")
  [Console]::Error.WriteLine("    $DoctorCommand")
} else {
  Write-Step "8/8 doctor: every check passed"
}

Write-Output ""
Write-Output "Restart every Claude Code session: they load the plugin when they start."
Write-Output "``cc-smart-dev-kit portal`` opens the portal in your own terminal (it prints a link with a one-time token)."
if ($DoctorFailed) { exit 1 }
exit 0
