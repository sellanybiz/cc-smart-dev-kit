#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
git init -q -b main
git config user.name "Test Person"
git config user.email test@example.com
git config commit.gpgsign false
mkdir -p .claude/rules
printf '# Install\n\nRun the installer.\n' > README.md
printf '# Docs style\n\nWrite short sentences. Use plain words.\n' > .claude/rules/docs-style.md
git add -A
git commit -q -m "Add the README and the docs-style rule"
printf '# Install\n\nRun the installer on macOS, Linux or Git Bash. It fetches the plugin from the\nmarketplace, sets the machine up and checks it afterwards.\n\n## Troubleshooting\n\nRun the doctor command in the project. It names the folder it checked and what it found.\n' > README.md
printf '# Docs style\n\nWrite short sentences. Use plain words. Explain a technical word the first time you use it.\nName the command a reader must run, in a code block.\n' > .claude/rules/docs-style.md
