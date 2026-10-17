#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
printf '{\n  "name": "math",\n  "type": "module",\n  "scripts": { "test": "node test.js" }\n}\n' > package.json
printf 'export function sum(a, b) {\n  return a - b;\n}\n' > math.js
printf 'import assert from "node:assert";\nimport { sum } from "./math.js";\n\nassert.strictEqual(sum(2, 3), 5);\nconsole.log("ok");\n' > test.js
