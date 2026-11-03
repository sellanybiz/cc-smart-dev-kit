#!/usr/bin/env bash
# The proof the Windows CI job runs, on a real Windows machine, that the plugin's hooks work
# there (docs/windows-hooks.md says why each piece is shaped the way it is). Five cases:
#
#   1. a hook bundle runs through the shim, through Git Bash — the shell Claude Code gives a
#      shell-form hook on Windows — and the git guard answers;
#   2. with no bun anywhere, the guard still fails closed: the shim's `--missing=ask` answer;
#   3. the line `cc-smart-dev-kit setup` writes into the person's own settings runs: the shell
#      expands `$HOME`, and Git Bash runs the extensionless `#!/bin/sh` launcher under it
#      (Windows has no execute bit, so what runs it is Git Bash's own rule for a file
#      starting with `#!`);
#   4. `--missing=fail`, the mode the plugin's command runs: no bun is one line on stderr and
#      exit 1, because a command must never report success when it did not run;
#   5. a process that ended is seen as gone: `process.kill(deadPid, 0)` throws `ESRCH` in Bun
#      on Windows, which the heavy-job queue and the worktree scan rely on (docs/windows-jobs.md).
#
# The same shell and the same checks run on Linux and macOS, so this is not Windows-only code
# that nothing else exercises: `bash scripts/windows-hook-smoke.sh`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
shim="$root/plugin/bin/cc-smart-dev-kit-bun.sh"
guard="$root/plugin/dist/git-guard.js"
# The shell Claude Code uses for a shell-form hook: Git Bash on Windows (CLAUDE_CODE_GIT_BASH_PATH
# says where it is), and bash here. Resolved before any PATH is changed below.
bash_bin="${CLAUDE_CODE_GIT_BASH_PATH:-$(command -v bash)}"
[ -n "$bash_bin" ] || { echo "windows-hook-smoke: no bash to run the hooks with" >&2; exit 1; }

fail() {
  echo "windows-hook-smoke: $1" >&2
  exit 1
}

work="$(mktemp -d)"
empty="$(mktemp -d)"
home="$(mktemp -d)"
trap 'rm -rf "$work" "$empty" "$home"' EXIT

# A project the guard answers in: a git repo with a cc-smart-dev-kit.json. Without that file a
# plugin hook stays silent, so the guard would print nothing.
mkdir -p "$work/repo/.claude"
printf '{}\n' >"$work/repo/.claude/cc-smart-dev-kit.json"
(cd "$work/repo" && git init -q -b main)

# The hook's input. `cwd` is a native path: the hook is a native program, so a Git Bash path
# like /tmp/x is not a folder it can read. `cygpath -m` is Git Bash's own `C:/Users/…` form,
# the form Claude Code hands a shell-form hook on Windows. Nothing else changes.
if command -v cygpath >/dev/null 2>&1; then
  cwd="$(cygpath -m "$work/repo")"
else
  cwd="$work/repo"
fi
input="$(printf '{"hook_event_name":"PreToolUse","cwd":"%s","tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' "$cwd")"

# 1. bun is installed on this machine: the shim finds it, the guard reads the command and asks.
answer="$(printf '%s' "$input" | "$bash_bin" "$shim" --missing=ask "$guard")"
case "$answer" in
  *'"permissionDecision":"ask"'*) ;;
  *) fail "the git guard did not answer with a PreToolUse ask: $answer" ;;
esac
case "$answer" in
  *"bun was not found"*) fail "the shim found no bun: $answer" ;;
esac
case "$answer" in
  *"older than the plugin needs"*)
    # The shim refuses a bun below MIN_BUN the way it refuses a missing one, so the guard
    # cannot run here. CI pins the right bun with setup-bun; a machine that does not has to
    # put one on PATH.
    fail "the bun on PATH is older than the plugin needs (MIN_BUN in src/build-info/bun.ts), so the shim refused it: $answer"
    ;;
esac
case "$answer" in
  *"git reset --hard"*) ;;
  *) fail "the guard's answer does not name the command it judged: $answer" ;;
esac

# 2. No bun anywhere: an empty folder for HOME and for PATH, and no $BUN_INSTALL. The shim
#    cannot run the guard, so it must fail closed — one ask, which is what a guard owes a call
#    it cannot judge.
answer="$(printf '%s' "$input" | BUN_INSTALL= HOME="$empty" PATH="$empty" "$bash_bin" "$shim" --missing=ask "$guard")"
case "$answer" in
  *'"permissionDecision":"ask"'*) ;;
  *) fail "with no bun the shim did not fail closed: $answer" ;;
esac
case "$answer" in
  *"bun was not found"*) ;;
  *) fail "with no bun the shim did not say so: $answer" ;;
esac

# 3. The line `cc-smart-dev-kit setup` writes into the person's own settings
#    (src/setup/user-notify-hook.ts), taken from that code rather than copied, so this check
#    follows the source. The launcher here is a stand-in: what is proved is the LINE — `$HOME`
#    expanding, and Git Bash running the extensionless `#!/bin/sh` file it points at.
mkdir -p "$home/.local/bin"
printf '#!/bin/sh\nprintf "launcher ran: %%s\\n" "$*"\n' >"$home/.local/bin/cc-smart-dev-kit"
chmod +x "$home/.local/bin/cc-smart-dev-kit"
line="$(cd "$root" && bun -e 'const { USER_NOTIFY_COMMAND } = await import("./src/setup/user-notify-hook.ts"); process.stdout.write(USER_NOTIFY_COMMAND);')"
case "$line" in
  '"$HOME/.local/bin/cc-smart-dev-kit" hook notify') ;;
  *) fail "the user-hook line changed shape, so this check no longer checks it: $line" ;;
esac
ran="$(HOME="$home" "$bash_bin" -c "$line")"
[ "$ran" = "launcher ran: hook notify" ] || fail "the user-wired line did not run the launcher: $ran"

# 4. With no bun anywhere, `--missing=fail` — the mode `plugin/bin/cc-smart-dev-kit` runs the
#    command through — writes one line on stderr and exits 1. A command that did not run must
#    never report success.
set +e
refusal="$(printf '%s' "$input" | BUN_INSTALL= HOME="$empty" PATH="$empty" "$bash_bin" "$shim" --missing=fail "$guard" 2>&1 >/dev/null)"
code=$?
set -e
[ "$code" = 1 ] || fail "--missing=fail exited $code, not 1: $refusal"
case "$refusal" in
  *"the command did not run"*) ;;
  *) fail "--missing=fail did not say the command did not run: $refusal" ;;
esac

# 5. A process that has ended is "gone" to the heavy-job queue and the worktree scan
#    (`processIsGone`, src/jobs/windows.ts). It reads only `ESRCH` as "gone"; any other error
#    counts as alive, so the job wait never runs on top of a live holder. That is safe only if
#    Bun throws `ESRCH` for `process.kill(deadPid, 0)` on native Windows: libuv's `uv_kill`
#    returns UV_ESRCH for a pid that is gone, but nothing proved that Bun's own `process.kill`
#    reaches it (docs/windows-jobs.md). This case runs the real function against a child that
#    has exited and against this process, and prints the code Bun threw, so a different one
#    shows up in the CI log and fails here — not in a job that waits for ever.
proved="$(cd "$root" && bun -e '
const { processIsGone } = await import("./src/jobs/windows.ts");
const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" });
await child.exited;
let code = "none";
try { process.kill(child.pid, 0); } catch (error) { code = String(error.code); }
const gone = processIsGone(child.pid);
const alive = !processIsGone(process.pid);
process.stdout.write(`${code} ${gone} ${alive}`);
')"
[ "$proved" = "ESRCH true true" ] || fail "a process that ended is not seen as gone (the code Bun threw, processIsGone of the ended child, not of this process): $proved"

echo "windows-hook-smoke: the shim ran a hook bundle, the guard failed closed with no bun, the user-wired line ran the launcher, --missing=fail exited 1, and an ended process is seen as gone"
