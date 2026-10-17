#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
printf 'export function pageCount(total, size) {\n  return Math.floor(total / size) + 1;\n}\n' > src/pagination.js
printf '// slow: loops over the list twice\nexport function format(list) {\n  var out = [];\n  for (var i = 0; i < list.length; i++) out.push(String(list[i]));\n  for (var j = 0; j < out.length; j++) out[j] = out[j].trim();\n  return out;\n}\n' > src/format.js
