#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
printf 'export function tally(list) {\n  let x = 0;\n  for (const item of list) {\n    if (item.ok) x += 1;\n  }\n  return x;\n}\n' > src/counter.js
