#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src/lookup .claude/plans .claude/briefs
printf '{\n  "workflow": { "crew": { "enabled": true } }\n}\n' > .claude/cc-smart-dev-kit.json
printf '{\n  "name": "my-app",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n' > package.json
cat > src/lookup/index.js <<'CODE'
export function lookup(items, query) {
  return items.filter((item) => item.name.includes(query));
}
CODE
cat > .claude/briefs/B1.md <<'BRIEF'
# B1 the lookup index

Build the lookup index: an exact and a prefix match over item names, ranked, with tests.

**Files you own:** `src/lookup/**`

**Done-check:** the targeted tests and the whole suite pass, the phase has its one review, and
the work is committed on `crew/B1-lookup` (never pushed). Then hand back with
`cc-smart-dev-kit crew report --status done`.

**For:** the lead `LEAD my-app master-plan`.
BRIEF
cat > .claude/plans/2026-01-01-lookup.md <<'PLAN'
# Look up items

**Status:** Approved

## Phases

| Wave | Phase | Files | About | Waits for |
|---|---|---|---|---|
| 1 | B1 the lookup index: tokenize names, build and update an index, ranked matches, tests | `src/lookup/**` | 60 min | nothing |
| 1 | B2 the lookup endpoint: query parsing, paging, errors, tests | `src/api/lookup.js` | 60 min | nothing |
PLAN
git add -A
git commit -q -m "Build the lookup index"
