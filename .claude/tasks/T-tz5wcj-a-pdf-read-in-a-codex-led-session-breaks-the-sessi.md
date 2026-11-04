---
id: "T-tz5wcj"
title: "A PDF read in a Codex-led session breaks the session for good (router 424)"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-04"
from: "branch worktree-refusal-and-stop-guard"
---
## What happens
A main session whose model slot runs on Codex (`opus` slot → `omniroute:codex/gpt-6.1-sol`) reads a PDF with the Read tool. The next request fails with the router's 424: `omniroute:codex/gpt-6.1-sol refused this request (HTTP 400): Missing required parameter: 'input[8].content[0]'`. Claude Code resends the whole history every turn, so every later turn fails the same way. The session is stuck until `/rewind` or a slot switch. Seen 2026-11-04 (router journal: three WARN lines "answered 400; returned as a 424").

## What is known
- The router passes the Anthropic Messages body to OmniRoute's `/v1/messages` (`src/gateway/router.ts`, the backend upstream) and relays the 400 as a 424 (`src/gateway/refusal.ts` `backendRefusal`, called from `router.ts` near the `isRefusalStatus` branch). That follows `.claude/rules/gateway.md`.
- OmniRoute 3.8.52 converts the message: Claude → Chat (`claude-to-openai.ts`, a `document` becomes a `file` part moved into its own user message) → Responses (`openai-responses/toResponses.ts`, `input_file`, `filename` only when the Claude block has a `title`).
- The error names `content[0]` as missing, so the message likely reached Codex with EMPTY content: the file part may be dropped later (perhaps by OmniRoute's Codex provider), not merely sent without a filename. Not proved: no request bodies are logged.
- The router's WARN hint (`UNSUPPORTED` in `router.ts`) does not match "Missing required parameter", so no hint is logged.

## What to do
1. Find the exact cause: about two tiny test requests straight to OmniRoute with a made-up PDF (with and without a `title`), never a person's file.
2. Fix at the root: a named, tested router translation if that is enough (`.claude/rules/gateway.md` § Never change prompt text: its own function, test and a `docs/claude-code-contract.md` row), else an upstream report to OmniRoute (ask the owner before posting).
3. Make the 424 say that every next turn fails the same way, and how to recover: `/rewind` to before the file read, or `cc-smart-dev-kit gateway slot <slot> claude`. Widen `UNSUPPORTED` so the WARN hint fires.
A router change rebuilds `plugin/dist/router.js`, so every machine's router restarts once on update: say so in the release notes.

The owner chose to leave this for later (2026-11-05).