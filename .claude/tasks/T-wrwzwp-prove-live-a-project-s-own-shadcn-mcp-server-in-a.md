---
id: "T-wrwzwp"
title: "Prove live: a project's own shadcn MCP server in a worktree session, and the user-scope server's folder"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-16"
from: "branch feat/shadcn"
---
Two 4.10.0 contract rows are owed live (docs/claude-code-contract.md § MCP servers): (1) a user-scope stdio server keeps the session's start folder after a move into a worktree; (2) whether a project-file shadcn server keeps running then, and whether the user-scope one stays hidden behind it. Doctor currently says a connected project copy needs nothing.