#!/usr/bin/env bash
#
# cc-smart-dev-kit's installer, for macOS and Linux: one command that does everything the
# machine can do by itself, and asks the person only for what only they have.
#
# HOW IT IS STARTED — the README has both lines, the first one for a private repository:
#
#   gh api repos/<owner>/cc-smart-dev-kit/contents/install.sh \
#     -H "Accept: application/vnd.github.raw" | bash -s -- <owner>/cc-smart-dev-kit
#   curl -fsSL https://raw.githubusercontent.com/<owner>/cc-smart-dev-kit/main/install.sh \
#     | bash -s -- <owner>/cc-smart-dev-kit
#
# WHY THE REPOSITORY IS AN ARGUMENT: the plugin names no owner anywhere (its own rule), so
# the script cannot carry one. The argument is `<owner>/<name>`, the same source `claude
# plugin marketplace add` takes. With no argument the script reads CC_SMART_DEV_KIT_REPO;
# with neither it prints one usage line and stops.
#
# WHY EVERY QUESTION READS THE TERMINAL, NEVER STDIN: the script arrives on a pipe, so its
# stdin is the script itself or the pipe's end — a question read from stdin would eat the
# script. The terminal is opened once, on fd 3, and every question reads from there. The
# commands this script runs are given that same fd as their stdin when they ask their own
# questions, and /dev/null when they must not read anything.
# CC_SMART_DEV_KIT_INSTALL_TTY points the script at another file instead; it is for the
# tests, not for people.
#
# WHAT IT NEVER DOES: it never passes a secret on a command line (a command line is readable
# in /proc and lands in the shell's history), never writes a secret file itself — the
# plugin's own commands own that — and never traces (a `set -x` would print every secret).
# It installs or upgrades nothing without asking. It refuses to run inside a Claude Code
# session, where it could replace the router that session's own model traffic goes through.
#
# THE STEPS, IN ORDER, each one line (a second run skips what is already done):
#
#   1. refuse inside a Claude Code session (CLAUDECODE, as `migrate` tests it);
#   2. `claude` on PATH, and git can read the repository;
#   3. Bun present and at least MIN_BUN (asked before it installs or upgrades one);
#   4. the three marketplaces added (this repository's, and the two companions');
#   5. the plugin installed — or updated when it is older, or enabled when it is off;
#   6. `migrate`, then `setup` (the move decides by itself what to move; setup is what
#      installs the instructions and the launcher), then the old plugin, asked about;
#   7. the three things only the person has: the browser's token, the gateway's key, the
#      Tavily key — each asked on the terminal, each skippable, never echoed, never printed;
#   8. `doctor`, then what is left, then the two closing lines.
#
# EXIT CODES: 0 done (every step this script ran succeeded, and doctor is all ✓); 3
# installed, with items left (doctor shows ✗, or something was skipped — the list at the end
# names each one and the line that finishes it); 1 a step failed (the line names the command
# that retries it, and running the installer again goes on from there); 2 refused (inside a
# Claude Code session, a question answered no, or no terminal to ask on).
#
# --dry-run prints the plan for this machine and changes nothing: it runs no `claude`, no
# setup, writes no file and reaches no network. It still reads this machine's local facts
# (which commands exist, their versions, what is already installed).
#
# EVERYTHING BELOW RUNS INSIDE `main`, and `main` is called on the last line: a script that
# arrived half-downloaded has a syntax error, bash never reaches that call, and nothing on
# the machine is touched (a bare script runs the commands it has already read).

# Never trace: a `set -x` (or a shell started with `-x`) prints every command line this
# script runs, and secrets pass through here.
set +x

set -u

# The oldest Bun cc-smart-dev-kit runs on: MIN_BUN in src/build-info/bun.ts, which
# package.json's `engines.bun` and CI's setup-bun also follow. A test keeps the two equal
# (scripts/install.test.ts).
MIN_BUN="1.4.3"

# The names this repository declares: the marketplace in .claude-plugin/marketplace.json
# and the plugin id in plugin/.claude-plugin/plugin.json. `claude plugin install` needs
# both halves of the id. The old names are what a 0.2.x machine still carries
# (README § Moving from anymodel).
MARKETPLACE="cc-smart-dev-kit"
PLUGIN="cc-smart-dev-kit@cc-smart-dev-kit"
OLD_PLUGIN="anymodel@anymodel"
OLD_MARKETPLACE="anymodel"

# The two companion marketplaces (README § Companion plugins): the plugin's dependencies
# come from them, and Claude Code installs a dependency only from a marketplace that is
# added. Each pair is the marketplace's own name (the key known_marketplaces.json uses)
# and the source `claude plugin marketplace add` takes.
COMPANION_MARKETPLACES="thedotmack|thedotmack/claude-mem claude-plugins-official|anthropics/claude-plugins-official"

usage() {
  printf 'usage: bash install.sh <owner>/<repo> [--dry-run]   (or set CC_SMART_DEV_KIT_REPO=<owner>/<repo>)\n'
}

# ─── the machine's paths (the same layout install.ps1 uses under %USERPROFILE%) ─────────
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PLUGINS_DIR="$CLAUDE_DIR/plugins"
KNOWN_MARKETPLACES="$PLUGINS_DIR/known_marketplaces.json"
INSTALLED_PLUGINS="$PLUGINS_DIR/installed_plugins.json"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/cc-smart-dev-kit"
# The router's own copy: `gateway setup` writes it, so its presence means a router was set
# up here before — and may be running, which is what the restart question is about.
ROUTER_COPY="$HOME/.local/share/cc-smart-dev-kit/router.js"

# ─── output ────────────────────────────────────────────────────────────────────────────
step() { printf '✓ %s\n' "$1"; }
skip() { printf '· %s\n' "$1"; }

# What is left when the run ends: one line an item, each with the exact command that
# finishes it. Filled in by the steps that skip something.
LEFT=()

# A step that failed: what failed, and the command that retries just that step.
failed() { # <what failed> <command to retry> [<command to retry> …]
  printf '✗ %s\n' "$1" >&2
  shift
  printf '  Retry just that step with:\n' >&2
  for command in "$@"; do printf '    %s\n' "$command" >&2; done
  printf '  Then run this installer again: it goes on from there.\n' >&2
  exit 1
}

# Refused: nothing has been changed yet — every refusal comes before the first write — so
# the machine is as it was. 2, so a script around this installer can tell a refusal from a
# failure.
refused() { # <why> [<command> …]
  printf '✗ %s\n' "$1" >&2
  shift
  if [ "$#" -gt 0 ]; then
    printf '  Run this, then run the installer again:\n' >&2
    for command in "$@"; do printf '    %s\n' "$command" >&2; done
  fi
  exit 2
}

# ─── the terminal ──────────────────────────────────────────────────────────────────────
TTY="${CC_SMART_DEV_KIT_INSTALL_TTY:-/dev/tty}"
TERMINAL_OPENED="no"

# Opens the terminal once, on fd 3, for every question this script and the commands it runs
# ask. Opened just before the first question, so `--dry-run` and a machine that needs
# nothing asked work with no terminal at all.
open_terminal() {
  [ "$TERMINAL_OPENED" = "yes" ] && return 0
  if [ ! -r "$TTY" ] || ! exec 3<"$TTY"; then
    # Started from a pipe: there is no terminal to ask on, and no answer may come from the
    # pipe (it holds the script). The README's own one-line form is what a person runs.
    refused "no terminal to ask on ($TTY is not readable): run this installer in your own terminal" \
      "gh api repos/$REPO/contents/install.sh -H \"Accept: application/vnd.github.raw\" | bash -s -- $REPO"
  fi
  TERMINAL_OPENED="yes"
}

# Every question writes its answer into `answer` (never into a command substitution: the
# prompt goes to stdout, and capturing stdout would capture the prompt too).
answer=""

# One line from the terminal; `answer` is empty at its end (a test's answers run out).
ask_line() { # <prompt>
  printf '%s ' "$1"
  answer=""
  read -r -u 3 answer || answer=""
  printf '\n'
}

# A secret from the terminal: not echoed, never printed, never in a command line, and never
# in a child's environment. The caller clears `answer` the moment it has copied it.
ask_secret() { # <prompt>
  printf '%s ' "$1"
  answer=""
  read -r -s -u 3 answer || answer=""
  printf '\n'
  export -n answer 2>/dev/null || true
}

# A yes/no question; `answer` is "no" unless the person writes yes.
ask_yes() { # <question>
  ask_line "$1 [y/N]"
  case "$answer" in
  [Yy] | [Yy][Ee][Ss]) answer="yes" ;;
  *) answer="no" ;;
  esac
}

# ─── reading this machine's state ──────────────────────────────────────────────────────
# One field out of a JSON file, read by the Bun this script has already checked: a shell
# cannot parse JSON, and `jq` is not on every machine. The expression is JavaScript over
# `d`, the parsed file. Prints nothing when the file, the path or the value is not there.
json_out() { # <file> <javascript>
  [ -f "$1" ] || return 0
  [ -n "$BUN" ] || return 0
  "$BUN" -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const v=($2);if(v!==undefined&&v!==null)console.log(String(v))}catch{}" \
    "$1" 2>/dev/null
}

# The user-scope install of the plugin: its folder, Claude Code's own record.
installed_path() {
  json_out "$INSTALLED_PLUGINS" \
    "((d.plugins||{})['$PLUGIN']||[]).filter(p=>p&&p.scope==='user').map(p=>p.installPath)[0]"
}

installed_version() {
  json_out "$INSTALLED_PLUGINS" \
    "((d.plugins||{})['$PLUGIN']||[]).filter(p=>p&&p.scope==='user').map(p=>p.version)[0]"
}

# True when Claude Code has the plugin turned on: the settings key `install` writes.
plugin_enabled() {
  [ "$(json_out "$SETTINGS_FILE" "((d.enabledPlugins||{})['$PLUGIN'])===true")" = "true" ]
}

# True when the old plugin is still installed under its old id: `migrate` removes it, but
# only after a yes on a terminal.
old_plugin_installed() {
  [ "$(json_out "$INSTALLED_PLUGINS" "Object.prototype.hasOwnProperty.call((d.plugins||{}),'$OLD_PLUGIN')")" = "true" ]
}

# The version the marketplace's own copy declares: what `claude plugin install` would put
# in place now. `<installLocation>/plugin` is the plugin's folder inside this repository
# (marketplace.json's `source`), so the manifest sits there.
marketplace_version() {
  local location
  location="$(json_out "$KNOWN_MARKETPLACES" "(d['$MARKETPLACE']||{}).installLocation")"
  [ -n "$location" ] || return 0
  json_out "$location/plugin/.claude-plugin/plugin.json" "d.version"
}

# "Already added" is Claude Code's own record, known_marketplaces.json, keyed by the
# marketplace's name — proved live: a source already added under another name (the rename
# from anymodel) was NOT reused, and a second marketplace was made instead, so only the
# name answers the question. This is the file the plugin's own `marketplaceAdded` reads.
marketplace_added() { # <name>
  [ "$(json_out "$KNOWN_MARKETPLACES" "Object.prototype.hasOwnProperty.call(d,'$1')")" = "true" ]
}

# True when this machine can run the gateway's router: systemd's user units are what its
# service uses on Linux, and the plugin's own refusal says the same (`routerServiceKind`:
# systemd, a Scheduled Task on Windows, else nothing).
gateway_service_possible() {
  case "$(uname -s 2>/dev/null || true)" in
  Linux*) command -v systemctl >/dev/null 2>&1 ;;
  *) return 1 ;;
  esac
}

# True when version $1 is at least $2. A numeric compare, field by field, so 1.10.0 is
# newer than 1.4.3. A pre-release of the minimum itself (1.4.3-canary.1) counts as older,
# exactly as `bunTooOld` in src/build-info/bun.ts counts it: it may be built before the fix.
version_at_least() { # <version> <minimum>
  local have="${1#v}" need="$2" pre="no" index havePart needPart
  case "$have" in
  *-*) have="${have%%-*}"; pre="yes" ;;
  esac
  local IFS=.
  local haveParts=() needParts=()
  read -r -a haveParts <<<"$have"
  read -r -a needParts <<<"$need"
  for index in 0 1 2; do
    havePart="${haveParts[$index]:-0}"
    needPart="${needParts[$index]:-0}"
    case "$havePart" in
    '' | *[!0-9]*) havePart=0 ;;
    esac
    case "$needPart" in
    '' | *[!0-9]*) needPart=0 ;;
    esac
    if [ "$havePart" -gt "$needPart" ]; then return 0; fi
    if [ "$havePart" -lt "$needPart" ]; then return 1; fi
  done
  [ "$pre" = "no" ]
}

# A path as one word for the shell a person pastes it into (single quotes, with any quote
# inside escaped) — no external tool, so the fake world of the tests needs none.
shell_word() { # <path>
  case "$1" in
  *[!A-Za-z0-9_./-]*) printf "'%s'" "${1//\'/\'\\\'\'}" ;;
  *) printf '%s' "$1" ;;
  esac
}

# Runs the plugin's own CLI with this machine's bun, in the exact form README § Install
# uses (both flags matter: Bun would otherwise read the folder's own `.env` files and its
# `bunfig.toml`). The caller decides stdin: the terminal for a question, a pipe for a key,
# /dev/null for a command that must not read anything.
run_cli() { # <command…>
  "$BUN" --no-env-file --config="$PLUGIN_DIR/bunfig.toml" "$PLUGIN_DIR/dist/cli.js" "$@"
}

# The same, on this machine's terminal. For every command that asks its own questions.
run_cli_on_terminal() { # <command…>
  run_cli "$@" <&3
}

# The same, reading nothing: a command that never asks the person must not be able to eat
# the terminal's answers, or a pipe meant for something else.
run_cli_quiet() { # <command…>
  run_cli "$@" </dev/null
}

# The line that retries one of the plugin's own commands, once it is installed: the
# launcher when setup has put it in place, else the exact `bun --no-env-file …` form.
# Every hint and retry line uses this, so a machine whose launcher is not there yet reads a
# line that works.
plugin_command() { # <command…>
  if [ -x "$LAUNCHER" ]; then
    printf '%s %s' "$LAUNCHER" "$*"
    return 0
  fi
  printf 'bun --no-env-file --config=%s %s/dist/cli.js %s' \
    "$(shell_word "$PLUGIN_DIR/bunfig.toml")" "$(shell_word "$PLUGIN_DIR")" "$*"
}

# ─── the run ───────────────────────────────────────────────────────────────────────────
main() {
  local DRY_RUN="no" REPO="" arg
  local added="" pair name source
  local have_version want_version restart_flag gateway_go
  local GATEWAY_KEY TAVILY_KEY
  local doctor_out doctor_code doctor_left line

  for arg in "$@"; do
    case "$arg" in
    --dry-run) DRY_RUN="yes" ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      printf 'install.sh: unknown option: %s\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$REPO" ]; then
        printf 'install.sh: one repository only, not two\n' >&2
        usage >&2
        exit 2
      fi
      REPO="$arg"
      ;;
    esac
  done
  [ -n "$REPO" ] || REPO="${CC_SMART_DEV_KIT_REPO:-}"
  if [ -z "$REPO" ]; then
    usage >&2
    exit 2
  fi
  case "$REPO" in
  */*) ;;
  *)
    printf 'install.sh: the repository is <owner>/<name>, not "%s"\n' "$REPO" >&2
    usage >&2
    exit 2
    ;;
  esac

  # The Bun this script will use, filled in by step 3.
  BUN=""
  BUN_VERSION=""

  if [ "$DRY_RUN" = "yes" ]; then
    printf 'cc-smart-dev-kit installer: dry run, the plan for this machine. Nothing is changed.\n'
    printf '  repository:   %s\n' "$REPO"
    printf '  marketplaces: %s, thedotmack/claude-mem, anthropics/claude-plugins-official\n' "$REPO"
    printf '  plugin:       %s, at the user scope\n' "$PLUGIN"
  else
    # The terminal, before the first change: every real run asks something (the Bun
    # question, `migrate` and `setup` ask their own), and a refusal must leave the machine
    # exactly as it was. A dry run asks nothing and needs none.
    open_terminal
  fi

  # ─── 1. inside a Claude Code session ─────────────────────────────────────────────────
  if [ -n "${CLAUDECODE:-}" ]; then
    refused "this installer cannot run inside a Claude Code session: it may replace the router this session's own model traffic goes through." \
      "open your own terminal and run the installer there"
  fi
  step "1/8 not inside a Claude Code session"

  # ─── 2. claude, and git can read the repository ──────────────────────────────────────
  CLAUDE_BIN="$(command -v claude || true)"
  if [ -z "$CLAUDE_BIN" ]; then
    failed "claude is not on PATH: the plugin is installed with Claude Code's own commands" \
      "install Claude Code: https://code.claude.com"
  fi

  # A private repository needs the person's git credentials. The check never waits for one
  # (GIT_TERMINAL_PROMPT=0, and ssh in BatchMode): a prompt in the middle of an installer is
  # worse than a line saying how to fix it. SSH first, then HTTPS — the order Claude Code's
  # own marketplace clone uses.
  git_can_read() {
    if [ "$DRY_RUN" = "yes" ]; then return 0; fi
    GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=8" \
      git ls-remote "git@github.com:$REPO.git" </dev/null >/dev/null 2>&1 && return 0
    GIT_TERMINAL_PROMPT=0 git ls-remote "https://github.com/$REPO.git" </dev/null >/dev/null 2>&1
  }
  if git_can_read; then
    if [ "$DRY_RUN" = "yes" ]; then
      skip "2/8 claude found: $CLAUDE_BIN; the dry run reaches no network, so git is not checked"
    else
      step "2/8 claude found: $CLAUDE_BIN, and git can read $REPO"
    fi
  else
    failed "git cannot read $REPO: a private repository needs your git credentials" \
      "gh auth login" \
      "gh auth setup-git"
  fi

  # ─── 3. Bun ──────────────────────────────────────────────────────────────────────────
  BUN="$(command -v bun || true)"
  [ -n "$BUN" ] && BUN_VERSION="$("$BUN" --version 2>/dev/null || true)"
  if [ -z "$BUN" ]; then
    if [ "$DRY_RUN" = "yes" ]; then
      skip "3/8 Bun is not installed: the plan asks to install it (the plugin needs $MIN_BUN or newer), and without Bun it cannot read what is already installed"
    else
      ask_yes "3/8 Bun is not installed. Install it with Bun's own installer (curl -fsSL https://bun.sh/install | bash)?"
      if [ "$answer" = "no" ]; then
        refused "Bun was not installed: cc-smart-dev-kit needs Bun $MIN_BUN or newer" \
          "curl -fsSL https://bun.sh/install | bash"
      fi
      if ! command -v curl >/dev/null 2>&1; then
        failed "curl is not installed, and Bun's own installer needs it" \
          "install curl (for example: sudo apt install curl)"
      fi
      printf '  installing Bun (https://bun.sh/docs/installation)…\n'
      # `pipefail` for this line only: without it a failed download is bash's own exit code
      # (0, from an empty script) and the install would look successful.
      if ! (set -o pipefail; curl -fsSL https://bun.sh/install </dev/null | bash); then
        failed "the Bun installer failed" "curl -fsSL https://bun.sh/install | bash"
      fi
      # Bun's installer puts the binary under BUN_INSTALL (`~/.bun` unless the person set
      # that), and adds the folder to the shell's PATH — not to this process's.
      BUN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
      [ -x "$BUN" ] || BUN="$(command -v bun || true)"
      if [ -z "$BUN" ]; then
        failed "Bun was installed, but it is not on PATH and not in ${BUN_INSTALL:-$HOME/.bun}/bin" \
          "export PATH=\"${BUN_INSTALL:-$HOME/.bun}/bin:\$PATH\""
      fi
      BUN_VERSION="$("$BUN" --version 2>/dev/null || true)"
      step "3/8 Bun installed: $BUN_VERSION"
    fi
  elif ! version_at_least "$BUN_VERSION" "$MIN_BUN"; then
    if [ "$DRY_RUN" = "yes" ]; then
      skip "3/8 Bun $BUN_VERSION is older than $MIN_BUN: the plan asks to upgrade it (bun upgrade)"
    else
      ask_yes "3/8 Bun $BUN_VERSION is older than $MIN_BUN. Upgrade it now with bun upgrade?"
      if [ "$answer" = "no" ]; then
        refused "Bun is still $BUN_VERSION: cc-smart-dev-kit needs Bun $MIN_BUN or newer" \
          "$BUN upgrade"
      fi
      printf '  upgrading Bun…\n'
      if ! "$BUN" upgrade </dev/null; then
        failed "bun upgrade failed" "$BUN upgrade"
      fi
      BUN_VERSION="$("$BUN" --version 2>/dev/null || true)"
      if ! version_at_least "$BUN_VERSION" "$MIN_BUN"; then
        # A Bun from a package manager upgrades through that manager, not through itself.
        failed "Bun is still $BUN_VERSION after the upgrade: it may come from a package manager" \
          "brew upgrade bun" \
          "scoop update bun" \
          "$BUN upgrade"
      fi
      step "3/8 Bun upgraded: $BUN_VERSION"
    fi
  else
    step "3/8 Bun $BUN_VERSION is new enough (the plugin needs $MIN_BUN or newer)"
  fi

  # ─── 4. marketplaces ─────────────────────────────────────────────────────────────────
  for pair in "$MARKETPLACE|$REPO" $COMPANION_MARKETPLACES; do
    name="${pair%%|*}"
    source="${pair#*|}"
    if marketplace_added "$name"; then continue; fi
    if [ "$DRY_RUN" = "no" ]; then
      if ! "$CLAUDE_BIN" plugin marketplace add "$source" </dev/null; then
        failed "adding the marketplace $source failed" "claude plugin marketplace add $source"
      fi
    fi
    added="${added}${added:+, }$source"
  done
  if [ -n "$added" ]; then
    if [ "$DRY_RUN" = "yes" ]; then
      skip "4/8 the plan adds: $added"
    else
      step "4/8 marketplaces added: $added"
    fi
  else
    step "4/8 all three marketplaces are already added"
  fi

  # ─── 5. the plugin ───────────────────────────────────────────────────────────────────
  # The install line names the marketplace: `claude plugin install cc-smart-dev-kit` without
  # `@cc-smart-dev-kit` can take the copy of the OLD marketplace, the one the move removes
  # last (README § Moving from anymodel).
  PLUGIN_DIR="$(installed_path)"
  have_version="$(installed_version)"
  want_version="$(marketplace_version)"
  if [ -n "$PLUGIN_DIR" ] && [ -n "$want_version" ] && [ "$have_version" = "$want_version" ]; then
    step "5/8 the plugin is installed, at the marketplace's version ($want_version)"
  elif [ "$DRY_RUN" = "yes" ]; then
    skip "5/8 the plugin is ${have_version:-not installed}: the plan installs or updates $PLUGIN at the user scope"
  elif [ -n "$PLUGIN_DIR" ]; then
    # An older copy: `claude plugin update` is the command that moves one version on, and
    # the plugin's own update runs exactly it (docs/claude-code-contract.md proves it).
    if ! "$CLAUDE_BIN" plugin update "$PLUGIN" --scope user </dev/null; then
      failed "updating the plugin failed" "claude plugin update $PLUGIN --scope user"
    fi
    PLUGIN_DIR="$(installed_path)"
    step "5/8 the plugin is updated ($(installed_version))"
  else
    if ! "$CLAUDE_BIN" plugin install "$PLUGIN" --scope user </dev/null; then
      failed "installing the plugin failed" "claude plugin install $PLUGIN --scope user"
    fi
    PLUGIN_DIR="$(installed_path)"
    if [ -z "$PLUGIN_DIR" ]; then
      failed "the install finished, but $INSTALLED_PLUGINS does not name the plugin's folder" \
        "claude plugin list"
    fi
    step "5/8 the plugin is installed ($(installed_version)): $PLUGIN_DIR"
  fi
  # Installed but turned off: enable it, or the plugin never loads. (A fresh install turns
  # it on itself.)
  if [ "$DRY_RUN" = "no" ] && [ -n "$PLUGIN_DIR" ] && ! plugin_enabled; then
    if ! "$CLAUDE_BIN" plugin enable "$PLUGIN" --scope user </dev/null; then
      failed "enabling the plugin failed" "claude plugin enable $PLUGIN --scope user"
    fi
    step "5/8 the plugin is enabled"
  fi

  # ─── 6. migrate, then setup ──────────────────────────────────────────────────────────
  if [ -z "$PLUGIN_DIR" ] && [ "$DRY_RUN" = "no" ]; then
    failed "the plugin's own folder is not in $INSTALLED_PLUGINS" \
      "claude plugin install $PLUGIN --scope user"
  fi
  if [ "$DRY_RUN" = "yes" ]; then
    skip "6/8 migrate runs (it moves a machine with the old anymodel names, and says \"Nothing to move.\" on one without them), then setup; both ask their own questions on the terminal"
  else
    # Its stdin is this script's terminal, so it asks its own questions there. Both commands
    # ask everything before they write anything.
    if ! run_cli_on_terminal migrate; then
      failed "migrate failed" "$(plugin_command migrate)"
    fi
    step "6/8 migrate finished (nothing to move on a machine without the old anymodel names)"
    # `setup` after the move, always: the move installs no instructions and no launcher of
    # its own (README § Moving from anymodel), and on a fresh machine setup is what puts
    # both in place.
    if ! run_cli_on_terminal setup; then
      failed "setup failed" "$(plugin_command setup)"
    fi
    step "6/8 setup finished"

    # The old plugin: `migrate` asks to remove it, but only when it is still installed and
    # only on a terminal. If it is still there, ask here — the two commands go last in the
    # move on purpose (removing a marketplace uninstalls the plugins installed from it).
    if old_plugin_installed; then
      ask_yes "6/8 The old anymodel plugin is still installed. Remove it, and the old anymodel marketplace with it?"
      if [ "$answer" = "yes" ]; then
        if ! "$CLAUDE_BIN" plugin uninstall "$OLD_PLUGIN" --scope user </dev/null; then
          failed "removing the old plugin failed" "claude plugin uninstall $OLD_PLUGIN"
        fi
        if marketplace_added "$OLD_MARKETPLACE"; then
          if ! "$CLAUDE_BIN" plugin marketplace remove "$OLD_MARKETPLACE" </dev/null; then
            failed "removing the old marketplace failed" "claude plugin marketplace remove $OLD_MARKETPLACE"
          fi
        fi
        step "6/8 the old anymodel plugin and marketplace are removed"
      else
        skip "6/8 the old anymodel plugin was left in place: run \`claude plugin uninstall $OLD_PLUGIN\`, then \`claude plugin marketplace remove $OLD_MARKETPLACE\`"
        LEFT+=("the old anymodel plugin: claude plugin uninstall $OLD_PLUGIN && claude plugin marketplace remove $OLD_MARKETPLACE")
      fi
    fi
  fi

  # ─── 7. what only the person has ─────────────────────────────────────────────────────
  # Every question is asked on the terminal, one at a time, and every one is skippable: a
  # "no", or an empty answer, leaves that thing out and names the command that adds it
  # later. A secret is read with no echo and reaches the plugin's own command on STDIN —
  # never on a command line, which the process list and the shell's history would show.
  if [ "$DRY_RUN" = "yes" ]; then
    skip "7/8 the dry run asks nothing: the browser's token, the gateway's key and the Tavily key are asked in a real run"
  else
    # The browser: `browser setup` finds Chrome, opens the Playwright extension's page in
    # the `claude-code` profile and prints the steps left for the person; `browser token`
    # then saves the token that page shows.
    ask_yes "7/8 Set up the browser (Playwright on your own Chrome)?"
    if [ "$answer" = "yes" ]; then
      run_cli_on_terminal browser setup || failed "browser setup failed" "$(plugin_command browser setup)"
      ask_yes "7/8 Paste the extension's token now (the extension's status page shows it)?"
      if [ "$answer" = "yes" ]; then
        # The prompt, the invisible typing and the token's shape check are the command's own.
        run_cli_on_terminal browser token || failed "the token was not saved" "$(plugin_command browser token)"
        step "7/8 the browser's token is saved"
      else
        skip "7/8 the browser's token was skipped: run \`$(plugin_command browser token)\` when you have it"
        LEFT+=("the browser's token: $(plugin_command browser token)")
      fi
    else
      skip "7/8 the browser was skipped: run \`$(plugin_command browser setup)\` later"
      LEFT+=("the browser: $(plugin_command browser setup), then $(plugin_command browser token)")
    fi

    # The gateway (optional): its router answers the affordable model slots, under systemd
    # on Linux. Where that cannot run, the question is skipped with the reason.
    if ! gateway_service_possible; then
      skip "7/8 the gateway was skipped: its router runs under systemd on Linux, and this machine has no systemd"
      LEFT+=("the gateway: README § The AI gateway (its router needs systemd on Linux)")
    else
      ask_yes "7/8 Set up the AI gateway now (affordable models for the haiku and sonnet subagents)?"
      if [ "$answer" != "yes" ]; then
        skip "7/8 the gateway was skipped: README § The AI gateway has its steps"
        LEFT+=("the gateway: $(plugin_command gateway setup --backend-key-stdin omniroute), then $(plugin_command gateway on)")
      else
        # A router already installed here may be running: `gateway setup` restarts it, and
        # a restart cuts every answer in flight. The command asks that question itself only
        # on a terminal, and this step's stdin is a pipe or /dev/null — so the person is
        # asked here, and `--yes` carries their answer to the command.
        restart_flag=""
        gateway_go="yes"
        if [ -f "$ROUTER_COPY" ]; then
          ask_yes "7/8 A router is already installed here: setup restarts it, and running Claude Code sessions fail until you restart them. Go on?"
          if [ "$answer" = "no" ]; then gateway_go="no"; fi
        fi
        if [ "$gateway_go" = "no" ]; then
          skip "7/8 the gateway was left as it is: run \`$(plugin_command gateway setup --yes)\` when you are ready"
          LEFT+=("the gateway (its router was not restarted): $(plugin_command gateway setup --yes)")
        else
          [ -f "$ROUTER_COPY" ] && restart_flag="--yes"
          ask_secret "7/8 Paste the OmniRoute API key (Enter to skip: every slot then answers on Claude):"
          GATEWAY_KEY="$answer"
          unset answer
          export -n GATEWAY_KEY
          if [ -n "$GATEWAY_KEY" ]; then
            # The key goes in on stdin, never as an argument.
            if ! printf '%s\n' "$GATEWAY_KEY" | run_cli gateway setup --backend-key-stdin omniroute $restart_flag; then
              unset GATEWAY_KEY
              failed "gateway setup failed" "$(plugin_command gateway setup --backend-key-stdin omniroute)"
            fi
          elif ! run_cli_quiet gateway setup --no-backend-key $restart_flag; then
            failed "gateway setup failed" "$(plugin_command gateway setup --no-backend-key)"
          fi
          unset GATEWAY_KEY
          step "7/8 the gateway is set up: turn it on with \`$(plugin_command gateway on)\` when you want it"
        fi
      fi
    fi

    # The Tavily key (optional): setup takes it on stdin, saves it as a file only this
    # account can read and copies it into your settings — the plugin's own command owns
    # every secret file, and this script writes none.
    ask_yes "7/8 Add your Tavily key now (the tavily-websearch MCP server)?"
    if [ "$answer" = "yes" ]; then
      ask_secret "7/8 Paste the Tavily API key (Enter to skip):"
      TAVILY_KEY="$answer"
      unset answer
      export -n TAVILY_KEY
      if [ -n "$TAVILY_KEY" ]; then
        if ! printf '%s\n' "$TAVILY_KEY" | run_cli setup --tavily-key-stdin; then
          unset TAVILY_KEY
          failed "saving the Tavily key failed" "$(plugin_command setup --tavily-key-stdin)"
        fi
        unset TAVILY_KEY
        step "7/8 the Tavily key is saved"
      else
        unset TAVILY_KEY
        skip "7/8 the Tavily key was skipped: write it to the key file, then run \`$(plugin_command setup)\`"
        LEFT+=("the Tavily key: README § MCP servers says where it goes, then $(plugin_command setup)")
      fi
    else
      skip "7/8 the Tavily key was skipped: README § MCP servers says where it goes"
      LEFT+=("the Tavily key: README § MCP servers says where it goes, then $(plugin_command setup)")
    fi
  fi

  # ─── 8. doctor, what is left, and the two closing lines ──────────────────────────────
  if [ "$DRY_RUN" = "yes" ]; then
    skip "8/8 the plan ends with \`doctor\`"
    printf '\nDry run: nothing was written, nothing ran, and no network was reached.\n'
    exit 0
  fi

  if [ -x "$LAUNCHER" ]; then
    doctor_out="$("$LAUNCHER" doctor 2>&1 </dev/null)"
  else
    doctor_out="$(run_cli doctor 2>&1 </dev/null)"
  fi
  doctor_code=$?
  printf '%s\n' "$doctor_out"
  if [ "$doctor_code" -eq 0 ]; then
    step "8/8 doctor: every check passed"
  else
    printf '✗ 8/8 doctor found what is left (its ✗ lines are in the list below)\n' >&2
  fi

  printf '\n'
  printf 'Restart every Claude Code session: they load the plugin when they start.\n'
  printf '`cc-smart-dev-kit portal` opens the portal in your own terminal (it prints a link with a one-time token).\n'

  # What is left: the items this run skipped, then doctor's own ✗ lines (each names what to
  # run where the plugin has a hint for it).
  doctor_left="$(printf '%s\n' "$doctor_out" | grep '^✗ ' 2>/dev/null || true)"
  if [ "${#LEFT[@]}" -gt 0 ] || [ -n "$doctor_left" ]; then
    printf '\nWhat is left:\n'
    for line in ${LEFT[@]+"${LEFT[@]}"}; do printf '  - %s\n' "$line"; done
    printf '%s\n' "$doctor_left" | while IFS= read -r line; do
      [ -n "$line" ] && printf '  %s\n' "$line"
    done
  fi

  if [ "$doctor_code" -ne 0 ]; then
    exit 3
  fi
  exit 0
}

main "$@"
