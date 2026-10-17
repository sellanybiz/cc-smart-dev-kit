#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src docs
printf 'export function a() {\n  // TODO: handle empty input\n  return 1;\n}\n' > src/a.ts
printf 'export function b() {\n  return 2; // TODO: cache this\n}\n' > src/b.ts
printf 'export const c = 3;\n' > src/c.ts
printf 'export function d() {\n  // TODO: remove after the migration\n  return 4;\n}\n' > src/d.ts
printf '# Notes\n\nTODO: write the setup section.\n' > docs/notes.md
printf 'export const e = 5;\n' > src/e.ts
