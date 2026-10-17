#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src .claude
printf '{\n  "worktrees": { "base": "main", "prefix": "app-wt-", "guardMainFolder": true }\n}\n' > .claude/cc-smart-dev-kit.json
printf 'export function notice() {\n  return "You will recieve an email.";\n}\n' > src/mail.ts
git add -A
git commit -q -m "Add mail"
