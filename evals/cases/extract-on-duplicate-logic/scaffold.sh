#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
printf 'export function cartTotal(cents) {\n  return "$" + (cents / 100).toFixed(2);\n}\n' > src/cart.js
printf 'export function invoiceTotal(cents) {\n  return "$" + (cents / 100).toFixed(2);\n}\n' > src/invoice.js
