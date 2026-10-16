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
# On Windows this shim runs under Git Bash (the shell Claude Code gives a shell-form hook
# there). Bun's Windows installer writes bun.exe, never a file called bun, and a hook's
# PATH may have no bun at all, so both names are tried. `$HOME` is Git Bash's own and it is
# %USERPROFILE%, so ~/.bun/bin is the same folder as $USERPROFILE/.bun/bin. The bun.exe
# behind the launcher or $BUN_INSTALL is a native `C:\…` path: the MSYS runtime behind Git
# Bash accepts Win32 paths as well as POSIX ones.
#
# The first argument says what to do when no bun is found, and is never passed to bun:
#   --missing=ask    the guards fail closed: one PreToolUse answer on stdout, asking the
#                    person, and exit 0 (a hook never stops a session).
#   --missing=quiet  one line on stderr, exit 0.
# Every hook in hooks.json gives one: the PreToolUse guards ask, every other hook is quiet.
#
# The launcher writes its baked bun in single quotes, each ' in the path written as '\''
# (`shellQuote` in src/setup/launcher.ts); the loop below undoes exactly that, so a bun under
# a folder like /home/o'brien works.
mode=--missing=quiet
case $1 in
  --missing=ask | --missing=quiet)
    mode=$1
    shift
    ;;
esac
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
for bun in "$baked" "${BUN_INSTALL:+$BUN_INSTALL/bin/bun}" "${BUN_INSTALL:+$BUN_INSTALL/bin/bun.exe}" "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bun.exe"; do
  if [ -n "$bun" ] && [ -x "$bun" ]; then exec "$bun" "$@"; fi
done
if bun=$(command -v bun 2>/dev/null) && [ -n "$bun" ]; then exec "$bun" "$@"; fi
if bun=$(command -v bun.exe 2>/dev/null) && [ -n "$bun" ]; then exec "$bun" "$@"; fi
if [ "$mode" = "--missing=ask" ]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"cc-smart-dev-kit cannot run its guard: bun was not found. Install bun or run cc-smart-dev-kit setup."}}'
  exit 0
fi
echo "cc-smart-dev-kit: bun not found (not in ~/.local/bin/cc-smart-dev-kit, \$BUN_INSTALL/bin, ~/.bun/bin or PATH), so the hook did not run. Install bun, then run: cc-smart-dev-kit setup" >&2
exit 0
