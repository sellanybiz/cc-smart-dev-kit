---
id: "T-ujx3cw"
title: "Raise .claude-code-version to 2.1.322 with the claude-code-upgrade skill"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-11"
from: "branch main"
---
The repo tests against the Claude Code version in `.claude-code-version`, which is older than 2.1.322. 4.1.0 relies on behaviour first seen on 2.1.321-2.1.322: Fable 5.2, and the `modelPicker` setting (alias rows, `replaceBuiltInOptions`) the kit writes while the gateway is on; the 4.0.0 Fable pin is retired. Run the `claude-code-upgrade` skill. It reads the changelog, walks `docs/claude-code-contract.md` row by row, proves the live rows (among them plansDirectory in a worktree session, the multi-row status line, and the kit's `/model` rows behind the gateway, per the `modelPicker` rows in `docs/claude-code-contract.md`), raises the file, and releases.