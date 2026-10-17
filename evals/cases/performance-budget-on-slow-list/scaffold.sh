#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
printf 'export function OrderList({ orders }) {\n  const sorted = [...orders].sort((a, b) => b.total - a.total);\n  return (\n    <ul>\n      {sorted.map((order) => (\n        <li key={order.id}>{order.name}: {order.total}</li>\n      ))}\n    </ul>\n  );\n}\n' > src/OrderList.jsx
printf '{\n  "name": "shop",\n  "dependencies": { "react": "^19.0.0" }\n}\n' > package.json
