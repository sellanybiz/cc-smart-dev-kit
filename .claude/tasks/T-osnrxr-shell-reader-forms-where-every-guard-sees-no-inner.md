---
id: "T-osnrxr"
title: "Shell reader: forms where every guard sees no inner command (here-doc piped to bash, process substitution, ssh/tmux/screen/at, interpreters' -c/-e)"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-12"
from: "phase C review of plan herdr-orchestration (#268), § Outside this change"
---
The shared shell reader (`src/shell/command.ts`, `invocationsOf`) returns no inner command for the forms below. So every Bash guard, the git guard included, misses a command hidden in them. Found by phase C's review on 2026-11-12, with `hc send` and `git push --force` as the hidden commands. Silent today:
- `cat <<'EOF' | bash`;
- `bash <(echo …)`, `source <(…)`, `. /dev/stdin <<<`;
- an alias defined on an earlier line;
- `tmux new -d '…'`, `screen -dm`, `at now <<<`, `ssh host <cmd>`;
- `strace -f`, `systemd-run`, `chronic`;
- `git -c core.pager=…`, `make SHELL=…`;
- shells nested deeper than `MAX_NESTING`;
- interpreters (`python3 -c`, `node -e`, `bun -e`, `perl -e`);
- PowerShell `& (Get-Command x) …`.

Decide per form:
- read it (the stdin of a shell, the wrappers);
- or ask, as a computed program (interpreters, ssh, nested too deep);
- or accept and document it.
Add matrix rows across the git, job and herdr rules.
Added by phase C's re-review on 2026-11-12. Two prefix readers still know only `NAME=`, now that the reader passes `NAME+=` prefixes on to them: `session-escape-guard.ts` (`ASSIGNS_CLAUDECODE`) and `after-merge.ts` (`GH_POINTING`). So `GH_REPO+=o/r gh pr merge` is read as gh, with no note about the repo. This is no regression, because those lines were not read at all before. Make both readers accept `+=` too.
