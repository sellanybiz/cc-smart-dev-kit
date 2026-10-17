#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src
printf 'export const a = 1;\n' > src/a.js
git add -A
git commit -q -m "Start"
git switch -q -c add-b
printf 'export const b = 2;\n' > src/b.js
git add -A
git commit -q -m "Add b"
printf 'export const b = 3;\n' > src/b.js
git commit -q -am "Raise b to 3"
