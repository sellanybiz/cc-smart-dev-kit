#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src/pages
printf 'export function SettingsPage() {\n  return null;\n}\n' > src/pages/Settings.tsx
printf 'export const colors = { background: "#fff", text: "#111" };\n' > src/styles.ts
printf '# App\n\nA small dashboard with one page so far: `src/pages/Home.tsx`.\n' > README.md
printf 'export function HomePage() {\n  return null;\n}\n' > src/pages/Home.tsx
