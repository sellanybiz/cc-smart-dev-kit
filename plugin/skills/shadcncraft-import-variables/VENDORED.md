# Vendored skill

Source: https://registry.npmjs.org/@shadcncraft/skills/-/skills-0.2.0.tgz
Ref: 0.2.0
Integrity: sha512-Kp9uq0zjz8eiloYqj6YF5dwBRozYhe/Plw1AThY7JUN3u93K/AClhF3TtnOVauT2uxxxodvT22yHROpVhFUa1g==
Upstream path: package/skills/shadcncraft-import-variables/
Date: 2026-11-16

Left out: agents/, evals/
Patches: bun-runner-and-pin, user-only.
The shadcn CLI pin comes from MCP_VERSIONS.shadcn in src/mcp/versions.ts (4.23.0).
Patch counts: {"runner":0,"pin":0,"dmi":1,"mcp":0}.

Re-vendor with bun scripts/vendor-skills.ts. Do not edit these files by hand.
