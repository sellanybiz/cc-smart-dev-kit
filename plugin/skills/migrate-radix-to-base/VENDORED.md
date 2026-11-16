# Vendored skill

Source: https://github.com/shadcn-ui/ui
Ref: e62c9435fff729a175f38983dee73b2cb4f6a069
Upstream path: skills/migrate-radix-to-base/
Date: 2026-11-16

Left out: agents/, evals/
Patches: bun-runner-and-pin, user-only.
The shadcn CLI pin comes from MCP_VERSIONS.shadcn in src/mcp/versions.ts (4.23.0).
Patch counts: {"runner":1,"pin":0,"dmi":1,"mcp":0}.

Re-vendor with bun scripts/vendor-skills.ts. Do not edit these files by hand.
