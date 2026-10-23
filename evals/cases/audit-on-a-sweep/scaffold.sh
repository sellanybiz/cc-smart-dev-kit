#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p src/hooks .claude
printf '{\n  "worktrees": { "base": "main" }\n}\n' > .claude/cc-smart-dev-kit.json
printf '{\n  "name": "my-app",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n' > package.json
cat > src/hooks/settings.js <<'EOF'
import { readFileSync } from "node:fs";

export function loadSettings(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
EOF
cat > src/hooks/notify.js <<'EOF'
import { loadSettings } from "./settings.js";

export function notify(message) {
  const settings = loadSettings("settings.json");
  if (settings.silent) return;
  try {
    process.stdout.write(`${message}\n`);
  } catch (error) {
    // the terminal is gone; nothing to do
  }
}
EOF
git add -A
git commit -q -m "Add the hooks"
