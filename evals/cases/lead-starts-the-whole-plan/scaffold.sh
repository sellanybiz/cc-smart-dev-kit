#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src/lookup src/api .claude/plans
printf '{\n  "workflow": { "crew": { "enabled": true } }\n}\n' > .claude/cc-smart-dev-kit.json
printf '{\n  "name": "my-app",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n' > package.json
printf 'export const items = [];\n' > src/db.js
printf 'import { items } from "../db.js";\n\nexport function list() {\n  return items;\n}\n' > src/api/items.js
cat > .claude/plans/2026-01-01-lookup.md <<'PLAN'
# Look up items

**Status:** Approved

## Goal

People can look up items by name, the API returns the matches, and the web page shows them.

## Phases

| Wave | Phase | Files | About | Waits for | Crew sessions |
|---|---|---|---|---|---|
| 1 | S1 the lookup index: tokenize names, build and update an index, ranked matches, tests | `src/lookup/**` | 60 min | nothing | a crew session, kind `build` |
| 1 | S2 the lookup endpoint: query parsing, paging, errors, tests, API docs | `src/api/lookup.js`, `docs/api.md` | 60 min | nothing (S1's contract is `lookup(query) -> Item[]`, fixed here) | a crew session, kind `build` |
| 2 | S3 lookup suggestions: suggest names as the person types, from S1's index, tests | `src/suggest/**` | 45 min | S1 merged (it reads the index's internals) | a crew session, kind `build` |

Each phase writes its failing tests first, runs the whole suite, and gets one review.
PLAN
git add -A
git commit -q -m "Add the lookup plan"
