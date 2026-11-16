#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
printf 'const files = process.argv.slice(2);\nfor (const file of files) {\n  console.log(file.toUpperCase());\n}\n' > cli.js
