#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src
printf 'export function price(cents) {\n  return cents / 100;\n}\n' > src/price.js
git add -A
git commit -q -m "Add price"
printf 'export function price(cents) {\n  return cents / 100;\n}\n\nexport function priceLabel(cents) {\n  return "$" + price(cents).toFixed(2);\n}\n' > src/price.js
git init -q --bare ../remote.git
git remote add origin ../remote.git
