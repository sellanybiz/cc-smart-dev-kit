#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src/routes
printf '{\n  "name": "my-app",\n  "type": "module",\n  "dependencies": { "express": "^4.19.0" }\n}\n' > package.json
printf 'import express from "express";\nimport { items } from "./routes/items.js";\n\nconst app = express();\napp.use(express.json());\napp.use("/items", items);\napp.listen(3000);\n' > src/server.js
printf 'import { Router } from "express";\nimport { db } from "../db.js";\n\nexport const items = Router();\nitems.get("/", (req, res) => res.json(db.items));\n' > src/routes/items.js
printf 'export const db = { items: [] };\n' > src/db.js
