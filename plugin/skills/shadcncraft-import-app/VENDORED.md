# Vendored skill

Source: https://registry.npmjs.org/@shadcncraft/skills/-/skills-0.2.0.tgz
Ref: 0.2.0
Integrity: sha512-Kp9uq0zjz8eiloYqj6YF5dwBRozYhe/Plw1AThY7JUN3u93K/AClhF3TtnOVauT2uxxxodvT22yHROpVhFUa1g==
Upstream path: package/skills/shadcncraft-import-app/
Date: 2026-11-16

Left out: agents/, evals/
Patches: bun-runner-and-pin, pin-unversioned-runner, user-only.
The shadcn CLI pin comes from MCP_VERSIONS.shadcn in src/mcp/versions.ts (4.23.0).
Patch counts: {"runner":0,"pin":0,"dmi":1,"mcp":0,"unversioned":0,"secret":0,"wording":0}.

## Upstream behaviour kept

- Upstream recommends particular models; the person's model choice and approval rules still apply.
- Import work keeps its own import-plan.json and build notes in the project.
- Upstream names shadcncraft-new-component, which 0.2.0 does not publish; those steps are unavailable.

Re-vendor with bun scripts/vendor-skills.ts. Do not edit these files by hand.
