#!/bin/sh
# Runs bun with the arguments after the mode, for the plugin's hooks
# (plugin/hooks/hooks.json), without needing bun on PATH: Claude Code's hooks get the PATH
# Claude Code started with, which may lack bun. It tries, in order:
#   1. the bun `cc-smart-dev-kit setup` baked into the launcher ~/.local/bin/cc-smart-dev-kit;
#   2. $BUN_INSTALL/bin/bun, then bun.exe beside it;
#   3. ~/.bun/bin/bun, then bun.exe beside it;
#   4. bun on PATH, then bun.exe.
# Only shell built-ins, so it works with an empty PATH too.
#
# Two flags, on every bun run:
#  - --no-env-file: bun would load the .env files of the working folder (the project) into the
#    hook, and a hook must see the environment Claude Code gave it — not a project's .env.local.
#    The launcher and bin/cc-smart-dev-kit do the same, and "cc-smart-dev-kit job run" refuses to
#    hand a job a folder's .env values.
#  - --config=<the plugin's own empty bunfig.toml>, in the plugin folder beside this script: bun
#    would otherwise read the working folder's bunfig.toml, and a project's `preload` would run
#    its own code inside the hook. The plugin ships that empty file; it is not /dev/null, which
#    is a device path and not a config the plugin owns.
#
# A Bun older than the plugin needs must not start a hook at all: it drops --no-env-file without
# a word (measured on Bun 1.2.23 and 1.3.0: the folder's .env values reached the program), and
# 1.4.3 is the first whose `fetch` honours `proxy: false` (src/build-info/bun.ts). So a too-old
# Bun fails closed here, exactly like a missing one, before it starts anything.
#
# On Windows this shim runs under Git Bash (the shell Claude Code gives a shell-form hook
# there). Bun's Windows installer writes bun.exe, never a file called bun, and a hook's
# PATH may have no bun at all, so both names are tried. `$HOME` is Git Bash's own and it is
# %USERPROFILE%, so ~/.bun/bin is the same folder as $USERPROFILE/.bun/bin. The bun.exe
# behind the launcher or $BUN_INSTALL is a native `C:\…` path: the MSYS runtime behind Git
# Bash accepts Win32 paths as well as POSIX ones, so `"$bun" --version` and the `-nt` test
# below read those paths like any other.
#
# The first argument says what to do when the program cannot run (no bun is found, the bun is
# too old, or, for a guard, the bundle is gone), and is never passed to bun:
#   --missing=ask    the guards fail closed: one PreToolUse answer on stdout, asking the
#                    person, and exit 0 (a hook never stops a session). A guard also asks when
#                    its bundle file is not there: Claude Code deletes an old plugin version
#                    folder some time after an update, and a bun that is told to run a file
#                    that is gone only prints its own error and exits 1, which Claude Code
#                    reads as a failure that lets the call through.
#   --missing=quiet  one line on stderr, exit 0.
#   --missing=fail   one line on stderr, exit 1: for a command that must not report success
#                    when it did not run (`plugin/bin/cc-smart-dev-kit`, the CLI).
# Every hook in hooks.json gives one: the PreToolUse guards ask, every other hook is quiet.
#
# The launcher writes its baked bun in single quotes, each ' in the path written as '\''
# (`shellQuote` in src/setup/launcher.ts); the loop below undoes exactly that, so a bun under
# a folder like /home/o'brien works.
mode=--missing=quiet
case $1 in
  --missing=ask | --missing=quiet | --missing=fail)
    mode=$1
    shift
    ;;
esac

# The PreToolUse answer for a guard that cannot run: an ask that names the fix. "$1" is the
# reason, in the words a person reads.
guard_answer() {
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"$1\"}}"
  exit 0
}

# What the line on stderr calls the program that did not run, and how it ends: a hook is
# quiet (exit 0), a command fails (exit 1).
what=hook
code=0
if [ "$mode" = "--missing=fail" ]; then
  what=command
  code=1
fi

# The oldest Bun the plugin runs on: the same number as MIN_BUN in src/build-info/bun.ts, and
# a test keeps the two equal. This script runs before any of the plugin's own code, so it
# cannot read that file.
min_bun=1.4.3

# The plugin's own empty Bun config: this script's folder is the plugin's bin/, so its parent
# is the plugin folder. Without a path in $0 (nobody calls it that way; a hook runs it by an
# absolute path) there is no folder to take, and the flag is left out.
shim_dir=${0%/*}
case $shim_dir in "$0") shim_dir= ;; esac

launcher="$HOME/.local/bin/cc-smart-dev-kit"
baked=
if [ -f "$launcher" ]; then
  while IFS= read -r line; do
    case $line in
      "baked_bun='"*"'")
        quoted=${line#"baked_bun='"}
        quoted=${quoted%"'"}
        baked=
        while :; do
          case $quoted in
            *"'\''"*)
              baked="$baked${quoted%%"'\''"*}'"
              quoted=${quoted#*"'\''"}
              ;;
            *)
              baked="$baked$quoted"
              break
              ;;
          esac
        done
        break
        ;;
    esac
  done <"$launcher"
fi

bun=
for candidate in "$baked" "${BUN_INSTALL:+$BUN_INSTALL/bin/bun}" "${BUN_INSTALL:+$BUN_INSTALL/bin/bun.exe}" "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bun.exe"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    bun=$candidate
    break
  fi
done
if [ -z "$bun" ]; then
  bun=$(command -v bun 2>/dev/null) || bun=
fi
if [ -z "$bun" ]; then
  bun=$(command -v bun.exe 2>/dev/null) || bun=
fi
if [ -z "$bun" ]; then
  if [ "$mode" = "--missing=ask" ]; then
    guard_answer "cc-smart-dev-kit cannot run its guard: bun was not found. Install bun or run cc-smart-dev-kit setup."
  fi
  echo "cc-smart-dev-kit: bun not found (not in ~/.local/bin/cc-smart-dev-kit, \$BUN_INSTALL/bin, ~/.bun/bin or PATH), so the $what did not run. Install bun, then run: cc-smart-dev-kit setup" >&2
  exit $code
fi

# True when $1 is a Bun version at or above $min_bun. A pre-release of the minimum itself
# (`1.4.3-canary.1`) counts as older, like `bunTooOld` says: it may have been built before the
# fix. A version that cannot be read counts as older too.
bun_is_new_enough() {
  case $1 in *.*.*) ;; *) return 1 ;; esac
  v_major=${1%%.*}
  v_rest=${1#*.}
  v_minor=${v_rest%%.*}
  v_rest=${v_rest#*.}
  v_patch=${v_rest%%[!0-9]*}
  case $v_major in "" | *[!0-9]*) return 1 ;; esac
  case $v_minor in "" | *[!0-9]*) return 1 ;; esac
  case $v_patch in "" | *[!0-9]*) return 1 ;; esac
  [ "$v_major" -gt "$min_major" ] && return 0
  [ "$v_major" -lt "$min_major" ] && return 1
  [ "$v_minor" -gt "$min_minor" ] && return 0
  [ "$v_minor" -lt "$min_minor" ] && return 1
  case $1 in *-* | *+*) [ "$v_patch" -gt "$min_patch" ] && return 0; return 1 ;; esac
  [ "$v_patch" -ge "$min_patch" ] && return 0
  return 1
}
min_major=${min_bun%%.*}
min_rest=${min_bun#*.}
min_minor=${min_rest%%.*}
min_patch=${min_rest#*.}

# The bun setup baked is the one setup itself ran on, and setup refuses to run on a bun older
# than the plugin needs — so it is not asked its version (no cost on a hook). Every other bun
# is asked: `bun --version` (about 3 ms, measured) does not read the working folder's
# bunfig.toml, so the project cannot influence the answer. A baked bun whose file changed
# after setup wrote the launcher (a `bun upgrade`) is asked too; one the person replaced at
# the same path by an older Bun is the one case this cannot see.
version=
if [ "$bun" != "$baked" ] || [ "$bun" -nt "$launcher" ]; then
  version=$("$bun" --version 2>/dev/null)
  bun_is_new_enough "$version" || {
    detail="needs Bun >= $min_bun"
    [ -n "$version" ] && detail="needs Bun >= $min_bun; this is $version"
    if [ "$mode" = "--missing=ask" ]; then
      guard_answer "cc-smart-dev-kit cannot run its guard: this Bun is older than the plugin needs ($detail). Run: bun upgrade"
    fi
    echo "cc-smart-dev-kit: this Bun is older than the plugin needs ($detail), so the $what did not run. Run: bun upgrade" >&2
    exit $code
  }
fi

# A guard whose bundle is not there asks, as when there is no bun: a guard fails closed. The
# bundle is the first word after the mode. Claude Code deletes an old plugin version folder
# some time after an update, and a session that still names it would otherwise get bun's own
# "module not found" and exit 1, which Claude Code reads as a failure that lets the call
# through (`onFailure: "block"` in hooks.json is the second belt, for a shim that is gone
# too). Only a guard checks: any other hook goes on to bun as it always did.
if [ "$mode" = "--missing=ask" ] && [ ! -f "$1" ]; then
  guard_answer "cc-smart-dev-kit cannot run its guard: its own program file is missing (an update may have removed this plugin version). Restart Claude Code, then run: cc-smart-dev-kit setup"
fi

if [ -n "$shim_dir" ]; then
  set -- "--config=$shim_dir/../bunfig.toml" "$@"
fi
exec "$bun" --no-env-file "$@"
