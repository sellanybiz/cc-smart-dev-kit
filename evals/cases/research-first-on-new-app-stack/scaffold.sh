#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
printf '{\n  "name": "my-app",\n  "type": "module",\n  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },\n  "devDependencies": { "typescript": "^5.6.0", "vite": "^7.0.0" }\n}\n' > package.json
