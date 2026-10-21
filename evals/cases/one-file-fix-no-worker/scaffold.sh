#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src .claude
printf '{\n  "workflow": { "workers": { "enabled": true } }\n}\n' > .claude/cc-smart-dev-kit.json
printf 'export function range(from, to) {\n  const out = [];\n  for (let n = from; n < to; n += 1) out.push(n);\n  return out;\n}\n' > src/range.js
git add -A
git commit -q -m "Add range"
