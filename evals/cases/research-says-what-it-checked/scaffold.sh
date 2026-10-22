#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
printf '{\n  "name": "my-app",\n  "type": "module",\n  "devDependencies": { "typescript": "^5.6.0" }\n}\n' > package.json
