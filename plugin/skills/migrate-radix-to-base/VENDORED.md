# Vendored skill

Source: https://github.com/shadcn-ui/ui
Ref: e62c9435fff729a175f38983dee73b2cb4f6a069
Upstream path: skills/migrate-radix-to-base/
Date: 2026-11-16

Left out: agents/, evals/
Patches: bun-runner-and-pin, pin-unversioned-runner, user-only.
The shadcn CLI pin comes from MCP_VERSIONS.shadcn in src/mcp/versions.ts (4.23.0).
Patch counts: {"runner":1,"pin":0,"dmi":1,"mcp":0,"unversioned":0,"secret":0,"wording":0}.

## Upstream behaviour kept

- Migration uses one commit per component and writes its own .migration reports; the project's workflow and approval rules still apply.

Re-vendor with bun scripts/vendor-skills.ts. Do not edit these files by hand.
