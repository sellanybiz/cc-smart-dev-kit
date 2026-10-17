#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
printf 'export function sum(a: number, b: number) {\n  return a + b;\n}\n' > src/math.ts
printf 'export function parseDate(text: string) {\n  return new Date(text);\n}\n' > src/dates.ts
printf 'export const VERSION = "1.0.0";\n' > src/version.ts
printf 'export function greet(name: string) {\n  return `hi ${name}`;\n}\n' > src/greet.ts
