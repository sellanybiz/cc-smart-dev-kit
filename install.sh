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
#   2. `claude` on PATH, the GitHub CLI's account able to read the repository, and git able to
#      read it;
#   3. Bun present and at least MIN_BUN (asked before it installs or upgrades one);
#   4. the three marketplaces added (this repository's, and the two companions'), over HTTPS
#      when Claude Code's own ssh add was refused;
#   5. the plugin installed — or updated when it is older, or enabled when it is off;
#   6. `migrate`, then `setup` (the move decides by itself what to move; setup is what
#      installs the instructions and the launcher), then the old plugin, asked about;
#   7. the three things only the person has: the browser's token, the gateway's key, the
#      Tavily key — each asked on the terminal, each skippable, never echoed, never printed;
#   8. `doctor --json`, then what is left (each failure with its fix), then the two closing
#      lines.
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

# The version this installer ships with: `version` in plugin/.claude-plugin/plugin.json of the
# repository this script was downloaded from. A test keeps the two equal
# (scripts/install.test.ts). It is read back off the installed CLI after the install or update
# (step 5): a CLI older than this script would refuse the options this script passes it, and
# that is exactly what happened on the first real run (2026-10-17: the installed CLI was 0.4.1,
# it had no `--tavily-key-stdin`, and the run died at the Tavily step).
INSTALLER_VERSION="4.6.1"

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
# The Tavily key file setup reads a key from: a person who already has one there is not asked
# for a key again (the same rule `readTavilyKey` follows: environment first, then this file).
TAVILY_KEY_FILE="$CLAUDE_DIR/cc-smart-dev-kit/tavily.key"

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
# in a child's environment. The caller clears `answer` the moment it has copied it. The line
# is cleaned first (see `clean_secret`).
ask_secret() { # <prompt>
  printf '%s ' "$1"
  answer=""
  read -r -s -u 3 answer || answer=""
  clean_secret
  printf '\n'
  export -n answer 2>/dev/null || true
}

# The line a secret read just gave, cleaned. Many terminals (Warp among them) wrap a PASTE in
# the bracketed-paste markers ESC[200~ … ESC[201~, and a raw or silent read keeps every
# character — so a pasted token or key reached the plugin's own command with those markers in
# it and was refused as the wrong shape (live, 2026-10-17). The two markers go first (as
# SEQUENCES: dropping the ESC first would leave `[200~` behind), then every other control
# character, then the ends trimmed. Printable characters stay, a non-ASCII password included.
# The plugin cleans the same way (src/cli/secret-line.ts, `cleanSecretLine`): keep the two in
# step, and install.ps1's `Clear-Secret` with them.
clean_secret() {
  local start end
  start=$'\033[200~'
  end=$'\033[201~'
  answer="${answer//"$start"/}"
  answer="${answer//"$end"/}"
  answer="${answer//[$'\001'-$'\037'$'\177']/}"
  # Leading and trailing white space: `read` already dropped the line's end, a paste may add more.
  while [ "${answer# }" != "$answer" ]; do answer="${answer# }"; done
  while [ "${answer% }" != "$answer" ]; do answer="${answer% }"; done
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
  "$BUN" -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^\\uFEFF/,''));const v=($2);if(v!==undefined&&v!==null)console.log(String(v))}catch{}" \
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

# Claude Code's other record of a marketplace: the user settings' `extraKnownMarketplaces`,
# which `claude plugin marketplace add` writes with the entry's `source`. `setup` reads this
# one (it writes its `autoUpdate` key into the entry), so a marketplace the first record
# holds and this one lost — another tool rewriting settings.json — stops `setup`. Only the
# add writes the entry whole, so only the add repairs it: proved live that a repeat add of a
# marketplace already on disk declares it again and fetches nothing
# (docs/claude-code-contract.md).
#
# The same test `setup` makes (`marketplaceKnown`): the entry is an object. Three answers: a
# missing file is "not declared"; a file this reader cannot parse is NOT judged here — `setup`
# reads it with the plugin's own reader, and a repair loop cannot fix a file Claude Code reads
# differently — so it counts as declared; a parsed file answers by the entry.
marketplace_declared() { # <name>
  [ -f "$SETTINGS_FILE" ] || return 1
  [ "$(json_out "$SETTINGS_FILE" "(v=>v!==null&&typeof v==='object'&&!Array.isArray(v))((d.extraKnownMarketplaces||{})['$1'])")" != "false" ]
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

# The version the plugin's own CLI answers: `cli.js version` prints "cc-smart-dev-kit <version>",
# and the last word of it is the version. Empty when nothing answered. Nothing else runs and
# nothing is printed: the caller decides what to say. Read through the CLI's own command rather
# than the folder's name, because that is what the next steps really call.
cli_version() {
  local out
  out="$(run_cli_quiet version 2>/dev/null || true)"
  case "$out" in
  *" "*) printf '%s' "${out##* }" ;;
  *) printf '%s' "${out%$'\n'}" ;;
  esac
}

# The plugin's own MCP servers that are registered by SOMETHING ELSE, one per line as
# `<name><TAB><what runs instead>`. `mcp status --json` answers it read-only, and the
# rule for "ours" lives in the plugin (src/mcp/status.ts, one home with setup's own decision).
# Nothing when every one is the plugin's own, or when the check cannot read the file.
#
# Why the installer asks: a project's own script had registered `playwright` (and the other
# three) before cc-smart-dev-kit was installed, setup left them alone as it must, and its `!`
# line was never seen among the installer's output — so the old browser kept starting and the
# plugin's own never took over (live, 2026-10-17).
foreign_mcp_servers() {
  run_cli_quiet mcp status --json 2>/dev/null |
    "$BUN" -e 'let t="";for await(const c of Bun.stdin.stream()) t+=new TextDecoder().decode(c);
try{for(const s of (JSON.parse(t).servers||[])) if(s.state==="foreign") console.log(s.name+"\t"+(s.runsWhat||""))}catch{}'       2>/dev/null || true
}

# doctor's failures, one per line as `<what is wrong><TAB><its fix>`, read from `doctor --json`
# (the plugin's own report: src/cli/doctor.ts, `DoctorReport`). Never its text for a person:
# that has groups, folds and wraps, and its marks change with the terminal. Nothing when the
# JSON cannot be read.
doctor_failures() { # <doctor --json output>
  [ -n "$BUN" ] || return 0
  printf '%s' "$1" |
    "$BUN" -e 'let t="";for await(const c of Bun.stdin.stream()) t+=new TextDecoder().decode(c);
try{for(const g of (JSON.parse(t).groups||[])) for(const c of (g.checks||[])) if(c.status==="fail") console.log(c.text+"\t"+(c.fix||""))}catch{}' 2>/dev/null || true
}

# One pass over those servers: show what runs instead, and ask. A name is asked about ONCE per
# run (`mcp_asked`), so the second pass — after the Tavily key, whose arrival can change what
# the plugin registers — brings up only what is new. A yes removes the server and runs `setup`
# again, so the plugin registers its own WITH its record (that record is what lets `restore`
# take it back later).
mcp_foreign_pass() { # <step label>
  local label="$1" name runs replaced="no"
  while IFS="$(printf '\t')" read -r name runs; do
    [ -n "$name" ] || continue
    case " $mcp_asked " in
    *" $name "*) continue ;;
    esac
    mcp_asked="$mcp_asked $name"
    ask_yes "$label The \"$name\" server is registered by something else ($runs). Replace it with cc-smart-dev-kit's?"
    if [ "$answer" = "yes" ]; then
      if ! "$CLAUDE_BIN" mcp remove "$name" --scope user </dev/null; then
        failed "removing the old \"$name\" server failed" "claude mcp remove $name --scope user"
      fi
      replaced="yes"
    else
      skip "$label the \"$name\" server was left as it is: run \`claude mcp remove $name --scope user\`, then \`$(plugin_command setup)\`"
      LEFT+=("the \"$name\" MCP server (registered by something else): claude mcp remove $name --scope user && $(plugin_command setup)")
    fi
  done <<EOF
$(foreign_mcp_servers)
EOF
  if [ "$replaced" = "yes" ]; then
    if ! run_cli_on_terminal setup; then
      failed "setup failed" "$(plugin_command setup)"
    fi
    step "$label setup ran again: cc-smart-dev-kit's own MCP servers are registered"
  fi
}

# ─── the run ───────────────────────────────────────────────────────────────────────────
main() {
  local DRY_RUN="no" REPO="" arg
  local added="" redeclared="" pair name source add_out add_code on_disk
  local have_version want_version restart_flag gateway_go
  local cli_have gateway_check_out gateway_check_code gateway_saved gateway_tries gateway_code
  local mcp_asked=""
  local BROWSER_TOKEN GATEWAY_KEY TAVILY_KEY
  local doctor_json doctor_code doctor_left line fix

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

  # Can the GitHub CLI's account read the repository? That account is the one `gh auth
  # setup-git` wires into git, and without read access no marketplace of this repository can
  # be added — no retry helps until its owner grants the invitation. Nothing is asked when gh
  # is missing, when nobody is logged in, or when the account can see the repository: a machine
  # without gh is installed as before. The account is named from `gh api user --jq .login`, the
  # one call that also proves somebody is logged in; when it answers nothing (gh offline, say)
  # the check is skipped and the marketplace steps below report their own failure.
  check_repo_read_access() {
    command -v gh >/dev/null 2>&1 || return 0
    gh repo view "$REPO" --json name </dev/null >/dev/null 2>&1 && return 0
    local login
    login="$(gh api user --jq .login </dev/null 2>/dev/null || true)"
    [ -n "$login" ] || return 0
    failed "the GitHub account $login cannot read $REPO" \
      "ask the repository's owner for read access" \
      "accept the invitation at https://github.com/$REPO/invitations"
  }

  if git_can_read; then
    if [ "$DRY_RUN" = "yes" ]; then
      skip "2/8 claude found: $CLAUDE_BIN; the dry run reaches no network, so git is not checked"
    else
      step "2/8 claude found: $CLAUDE_BIN, and git can read $REPO"
    fi
  else
    # git's own line below names git credentials; when git is there and the GitHub account
    # cannot see the repository at all, that sends the person to fix credentials they already
    # have — so gh is asked, and names the account instead (live, 2026-10-17).
    if command -v git >/dev/null 2>&1; then check_repo_read_access; fi
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
  # Before the first add: read access is what makes it possible at all (the same check step 2
  # runs when git could not read the repository). Only when this repository's marketplace is
  # not added yet — a machine that already has it added is installed as before.
  if [ "$DRY_RUN" = "no" ] && ! marketplace_added "$MARKETPLACE"; then
    check_repo_read_access
  fi

  # The lines that mean ssh to GitHub was refused, and not that the repository is out of reach.
  # ssh's own two come first; git's summary line follows EITHER failure, so a "Repository not
  # found" beside it is access, not ssh, and the HTTPS form cannot fix that (live, 2026-10-17).
  ssh_refused() { # <the failed command's output>
    case "$1" in
    *"Permission denied (publickey)"* | *"Host key verification failed"*) return 0 ;;
    esac
    case "$1" in
    *"Could not read from remote repository"*)
      case "$1" in *"Repository not found"*) return 1 ;; esac
      return 0
      ;;
    esac
    return 1
  }

  for pair in "$MARKETPLACE|$REPO" $COMPANION_MARKETPLACES; do
    name="${pair%%|*}"
    source="${pair#*|}"
    # This repository's marketplace is added only when BOTH of Claude Code's records hold it:
    # known_marketplaces.json and the user settings, which is what `setup` reads. Only the
    # first: the same add runs again, and says it is a repair. The two companions stay on the
    # first record alone: `setup` reads nothing of them in the settings, and Claude Code
    # registers Anthropic's own marketplace by itself, which may leave no settings entry.
    on_disk="no"
    if marketplace_added "$name"; then
      if [ "$name" != "$MARKETPLACE" ] || marketplace_declared "$name"; then continue; fi
      on_disk="yes"
    fi
    if [ "$DRY_RUN" = "no" ]; then
      # Claude Code adds a marketplace over ssh by default, so a machine with no GitHub SSH
      # key (or a blocked port 22) is refused. The same marketplace over HTTPS works, and it
      # lands under the SAME name — that name comes from the repository's own marketplace file,
      # never from the source — so every step after this one finds it (live, 2026-10-17). One
      # retry, never a loop; any other failure is reported as it always was, with the command's
      # own words kept for whoever reads the line.
      add_out=""
      add_code=0
      add_out="$("$CLAUDE_BIN" plugin marketplace add "$source" </dev/null 2>&1)" || add_code=$?
      if [ "$add_code" -ne 0 ] && ssh_refused "$add_out"; then
        source="https://github.com/$source.git"
        skip "4/8 SSH to GitHub was refused, so the marketplace is added over HTTPS instead: $source"
        add_out=""
        add_code=0
        add_out="$("$CLAUDE_BIN" plugin marketplace add "$source" </dev/null 2>&1)" || add_code=$?
      fi
      if [ "$add_code" -ne 0 ]; then
        [ -z "$add_out" ] || printf '%s\n' "$add_out" >&2
        failed "adding the marketplace $source failed" "claude plugin marketplace add $source"
      fi
      # The add is what writes the settings entry: if it is still missing, `setup` would stop
      # on it, so stop here with the command.
      if [ "$name" = "$MARKETPLACE" ] && ! marketplace_declared "$name"; then
        failed "the settings still do not list the $name marketplace after adding $source" \
          "claude plugin marketplace add $source"
      fi
    fi
    if [ "$on_disk" = "yes" ]; then
      redeclared="${redeclared}${redeclared:+, }$source"
    else
      added="${added}${added:+, }$source"
    fi
  done
  if [ -n "$added" ] || [ -n "$redeclared" ]; then
    if [ "$DRY_RUN" = "yes" ]; then
      [ -z "$added" ] || skip "4/8 the plan adds: $added"
      [ -z "$redeclared" ] || skip "4/8 the plan re-declares in your settings: $redeclared"
    else
      [ -z "$added" ] || step "4/8 marketplaces added: $added"
      [ -z "$redeclared" ] || step "4/8 re-declared in your settings: $redeclared"
    fi
  else
    step "4/8 all three marketplaces are already added"
  fi

  # ─── 5. the plugin ───────────────────────────────────────────────────────────────────
  # The install line names the marketplace: `claude plugin install cc-smart-dev-kit` without
  # `@cc-smart-dev-kit` can take the copy of the OLD marketplace, the one the move removes
  # last (README § Moving from anymodel).
  #
  # The marketplace's own copy is REFRESHED FIRST, before any version is compared. "Already
  # installed, at the marketplace's version" is only true of a copy that is up to date: the
  # first real run (2026-10-17) had the marketplace added hours earlier at 0.4.1, the installer
  # compared the installed 0.4.1 with that stale clone's 0.4.1, saw them equal, updated
  # nothing — and then called a flag the installed 0.4.1 CLI did not have. `src/update/` runs
  # the same two steps in the same order (`plugin marketplace update`, then `plugin update`);
  # a shell script cannot import that code, so this is its own copy of the order, and
  # `scripts/install.test.ts` proves it.
  if [ "$DRY_RUN" = "no" ] && marketplace_added "$MARKETPLACE"; then
    if ! "$CLAUDE_BIN" plugin marketplace update "$MARKETPLACE" </dev/null; then
      failed "refreshing the $MARKETPLACE marketplace failed" \
        "claude plugin marketplace update $MARKETPLACE"
    fi
  fi
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
    # Both versions on the line: what moved, and what the marketplace's own copy declares.
    step "5/8 the plugin is updated ($have_version -> $want_version)"
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

  # The CLI that is really installed now, asked its own version. A CLI older than this script
  # does not have the options the later steps pass it (`--tavily-key-stdin`, `gateway check`),
  # and the first real run died exactly there: the marketplace's clone had been stale, so the
  # update never ran and a 0.4.1 CLI was called with a 0.4.2 flag. Stop with the two commands
  # that fix it instead of calling one. A version that cannot be read stops it too: this
  # script cannot promise an option a CLI it cannot see understands.
  if [ "$DRY_RUN" = "no" ] && [ -n "$PLUGIN_DIR" ]; then
    cli_have="$(cli_version)"
    if [ -z "$cli_have" ]; then
      failed "the installed cc-smart-dev-kit CLI's version could not be read: this installer cannot tell whether it has the options the later steps need" \
        "claude plugin marketplace update $MARKETPLACE" \
        "claude plugin update $PLUGIN --scope user"
    elif ! version_at_least "$cli_have" "$INSTALLER_VERSION"; then
      failed "the installed cc-smart-dev-kit CLI is $cli_have, older than this installer's $INSTALLER_VERSION: this installer would call options that version does not have" \
        "claude plugin marketplace update $MARKETPLACE" \
        "claude plugin update $PLUGIN --scope user"
    fi
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

    # The plugin's own MCP servers, when something else registered them first: setup leaves a
    # person's own server alone (the rule), so the installer asks — showing what runs instead,
    # and never a key (the line carries the command and its arguments only).
    mcp_foreign_pass "6/8"

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
    # the `claude-code` profile and prints the steps left for the person; the token is then
    # read HERE, with no echo, and reaches the command on stdin — never as an argument, and
    # never through a question that could swallow the paste. (A person pasted a token as the
    # answer to a yes/no question once, the run walked on with no token file, and the browser
    # never started: live, 2026-10-17.)
    ask_yes "7/8 Set up the browser (Playwright on your own Chrome)?"
    if [ "$answer" = "yes" ]; then
      run_cli_on_terminal browser setup || failed "browser setup failed" "$(plugin_command browser setup)"
      ask_secret "7/8 Paste the token from the extension's status page (it is not shown). Enter to skip:"
      BROWSER_TOKEN="$answer"
      unset answer
      export -n BROWSER_TOKEN
      if [ -n "$BROWSER_TOKEN" ]; then
        if ! printf '%s\n' "$BROWSER_TOKEN" | run_cli browser token; then
          unset BROWSER_TOKEN
          failed "the token was not saved" "$(plugin_command browser token)"
        fi
        unset BROWSER_TOKEN
        step "7/8 the browser's token is saved"
      else
        unset BROWSER_TOKEN
        skip "7/8 the browser's token was skipped: run \`$(plugin_command browser token)\` when you have it"
        LEFT+=("the browser's token: $(plugin_command browser token)")
      fi
    else
      skip "7/8 the browser was skipped: run \`$(plugin_command browser setup)\` later"
      LEFT+=("the browser: $(plugin_command browser setup), then $(plugin_command browser token)")
    fi

    # The gateway (optional): the local router and OmniRoute's key, under systemd on Linux.
    # Every slot stays Claude and the gateway stays off until the person says otherwise (D66):
    # no word here suggests a model or a switch. Where it cannot run, the question is skipped
    # with the reason.
    if ! gateway_service_possible; then
      skip "7/8 the gateway was skipped: its router runs under systemd on Linux, and this machine has no systemd"
      LEFT+=("the gateway: README § The AI gateway (its router needs systemd on Linux)")
    else
      ask_yes "7/8 Set up the AI gateway now (the local router and OmniRoute's key)?"
      if [ "$answer" != "yes" ]; then
        skip "7/8 the gateway was skipped: README § The AI gateway has its steps"
        LEFT+=("the gateway: $(plugin_command gateway setup --backend-key-stdin omniroute)")
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
          # Is the gateway working ALREADY? The plugin's own read-only check answers it, and
          # that is what decides whether anybody is asked for a key at all:
          #   0 it works (the backend accepts the key in gateway.json)
          #   1 there is no OmniRoute key yet, and an OmniRoute answers: setup can MAKE one
          #     from the dashboard password
          #   4 the key there is one OmniRoute refuses: a new API key is what fixes it
          #   3 it could not be judged (no OmniRoute answers, or the config cannot be read)
          # The first real run asked for a key anyway on a machine whose gateway worked
          # (2026-10-17), a provider key was pasted over the router's own, and every
          # affordable subagent fell back to Claude. That is why this check comes first.
          gateway_check_out="$(run_cli_quiet gateway check 2>&1)"
          gateway_check_code=$?
          gateway_saved="no"
          if [ "$gateway_check_code" = "0" ]; then
            skip "7/8 the gateway already works, so no key is asked: $gateway_check_out"
          elif [ "$gateway_check_code" = "1" ] || [ "$gateway_check_code" = "4" ]; then
            # The key question, asked at most twice: a key the backend refuses is refused by
            # `gateway setup` itself (it tests the key before it saves it, and keeps the old
            # one), and its own line on the terminal says why. Enter skips it.
            gateway_tries=0
            while [ "$gateway_tries" -lt 2 ]; do
              if [ "$gateway_check_code" = "1" ]; then
                ask_secret "7/8 Paste your OmniRoute dashboard password, and setup makes the router's key itself (it is never stored, and never shown). Enter to skip:"
                GATEWAY_KEY="$answer"
                unset answer
                export -n GATEWAY_KEY
                if [ -z "$GATEWAY_KEY" ]; then
                  unset GATEWAY_KEY
                  break
                fi
                printf '%s\n' "$GATEWAY_KEY" | run_cli gateway setup --omniroute-password-stdin --save-unchecked $restart_flag
                gateway_code=$?
              else
                ask_secret "7/8 Paste the OmniRoute API key the router uses (OmniRoute's dashboard → API keys; not your Ollama key). Enter to skip:"
                GATEWAY_KEY="$answer"
                unset answer
                export -n GATEWAY_KEY
                if [ -z "$GATEWAY_KEY" ]; then
                  unset GATEWAY_KEY
                  break
                fi
                printf '%s\n' "$GATEWAY_KEY" | run_cli gateway setup --backend-key-stdin omniroute $restart_flag
                gateway_code=$?
              fi
              unset GATEWAY_KEY
              if [ "$gateway_code" -eq 0 ]; then
                gateway_saved="yes"
                break
              fi
              gateway_tries=$((gateway_tries + 1))
              if [ "$gateway_tries" -lt 2 ]; then
                printf '  That was not saved: the line above says why, and the gateway keeps the key it had. README § The AI gateway says which key OmniRoute wants. One more try.\n' >&2
              fi
            done
            if [ "$gateway_saved" = "no" ]; then
              skip "7/8 the gateway keeps the key it had: give it a new one with \`$(plugin_command gateway setup --backend-key-stdin omniroute)\`, or let setup make one with \`$(plugin_command gateway setup --omniroute-password)\`"
              LEFT+=("the gateway's key: README § The AI gateway says which key OmniRoute wants, then $(plugin_command gateway setup --backend-key-stdin omniroute)")
            fi
          else
            # 3, or anything this script does not know: ask nothing, and say what the check
            # said. A machine with no OmniRoute at all cannot use the gateway yet, so the item
            # goes to the list at the end (live, 2026-10-17).
            skip "7/8 the gateway is left as it is: $gateway_check_out"
            LEFT+=("the gateway: README § The AI gateway says how to install and run OmniRoute, then $(plugin_command gateway setup --omniroute-password)")
          fi
          # The router's copy and its service are refreshed whenever no key was saved: a
          # machine that has a key keeps it (`--no-backend-key` changes no key).
          if [ "$gateway_saved" = "yes" ]; then
            step "7/8 the gateway is set up: the router and OmniRoute's key are ready"
          else
            if ! run_cli_quiet gateway setup --no-backend-key $restart_flag; then
              failed "gateway setup failed" "$(plugin_command gateway setup --no-backend-key)"
            fi
            if [ "$gateway_check_code" = "0" ]; then
              step "7/8 the gateway is up to date: the router and OmniRoute's key are ready"
            else
              skip "7/8 the router's copy and service are refreshed, and the gateway's key is untouched"
            fi
          fi
        fi
      fi
    fi

    # The Tavily key (optional): setup takes it on stdin, saves it as a file only this
    # account can read and copies it into your settings — the plugin's own command owns
    # every secret file, and this script writes none. NOT asked when a key is already there
    # for setup to read: the variable in this environment, the key file, or the settings. A
    # person whose project already uses a Tavily MCP server must not be asked for a key they
    # have (live, 2026-10-17).
    if [ -n "${TAVILY_API_KEY:-}" ]; then
      skip "7/8 Tavily: using TAVILY_API_KEY from your environment (nothing is asked, nothing is written)"
    elif [ -s "$TAVILY_KEY_FILE" ]; then
      skip "7/8 Tavily: using the key already in $(shell_word "$TAVILY_KEY_FILE") (nothing is asked)"
    elif [ "$(json_out "$SETTINGS_FILE" "(((d.env||{})['TAVILY_API_KEY'])||'')!==''")" = "true" ]; then
      skip "7/8 Tavily: using the TAVILY_API_KEY already in $(shell_word "$SETTINGS_FILE") (nothing is asked)"
    else
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

    # Again, now that a Tavily key may have arrived: what the plugin registers changed, and a
    # `tavily-websearch` of someone else's must not go on shadowing it. A name already asked
    # about in step 6 is not asked again (mcp_foreign_pass).
    mcp_foreign_pass "7/8"
  fi

  # ─── 8. doctor, what is left, and the two closing lines ──────────────────────────────
  if [ "$DRY_RUN" = "yes" ]; then
    skip "8/8 the plan ends with \`doctor\`"
    printf '\nDry run: nothing was written, nothing ran, and no network was reached.\n'
    exit 0
  fi

  # The report as JSON, read for its failures: a person reads the step line and the list below,
  # and `doctor` itself shows every check.
  if [ -x "$LAUNCHER" ]; then
    doctor_json="$("$LAUNCHER" doctor --json </dev/null)"
  else
    doctor_json="$(run_cli doctor --json </dev/null)"
  fi
  doctor_code=$?
  doctor_left="$(doctor_failures "$doctor_json")"
  if [ "$doctor_code" -eq 0 ]; then
    step "8/8 doctor: every check passed"
  else
    printf '✗ 8/8 doctor found what is left (the list below; `%s` shows every check)\n' "$(plugin_command doctor)" >&2
  fi

  printf '\n'
  printf 'Restart every Claude Code session: they load the plugin when they start.\n'
  printf '`cc-smart-dev-kit portal` opens the portal in your own terminal (it prints a link with a one-time token).\n'

  # A doctor that failed without a report it could read: say so, so the list is never empty.
  if [ "$doctor_code" -ne 0 ] && [ -z "$doctor_left" ]; then
    doctor_left="doctor did not finish its report$(printf '\t')run \`$(plugin_command doctor)\` to see why"
  fi

  # What is left: the items this run skipped, then each of doctor's failures with its fix.
  if [ "${#LEFT[@]}" -gt 0 ] || [ -n "$doctor_left" ]; then
    printf '\nWhat is left:\n'
    for line in ${LEFT[@]+"${LEFT[@]}"}; do printf '  - %s\n' "$line"; done
    while IFS="$(printf '\t')" read -r line fix; do
      [ -n "$line" ] || continue
      printf '  ✗ %s\n' "$line"
      [ -n "$fix" ] && printf '    Fix: %s\n' "$fix"
    done <<EOF
$doctor_left
EOF
  fi

  if [ "$doctor_code" -ne 0 ]; then
    exit 3
  fi
  exit 0
}

main "$@"
