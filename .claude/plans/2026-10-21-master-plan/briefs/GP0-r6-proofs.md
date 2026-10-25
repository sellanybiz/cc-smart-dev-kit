# GP0 — R6's live proofs, before the gateway per project is built

## Goal, and why

1.2.0 lets a project (and a single session) choose its own gateway state: on, off, or a profile
of its own (D29, `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.0). GP1 (merged) taught
the router the `/p/<profile>` prefix. GP2 (a project's on/off/default), GP3 (`launch`) and GP5
(an explicit URL instead of a removed key) rest on Claude Code behaviour that the docs state but
nobody has proved here. R6 (`.claude/research/archive/2026-10-21-master-plan.md` § R6) lists the
proofs. This phase runs them and writes each result where the build phases will read it. A
proof that fails changes a design: say so plainly, never bend the result.

## The proofs (each its own `claude -p` run)

P5 (a path in `ANTHROPIC_BASE_URL` is kept) is already proved: `docs/claude-code-contract.md`
§ the row "A path in `ANTHROPIC_BASE_URL` is kept on every request". Run the others:

- **P1** — an explicit `ANTHROPIC_BASE_URL=https://api.anthropic.com` keeps the person's claude.ai
  login (the request authenticates with the saved OAuth login, not an API key). This one needs the
  real login: run it with the person's own config folder but **your own `--settings` file** that
  sets only that env value, `--model haiku --effort max`, the prompt `Say ok`, `--output-format
  stream-json --verbose`; read the start line (`apiKeySource` or the equivalent) and that the
  answer came back. One tiny request; nothing else.
- **P3** — `--settings` beats the project's own `.claude/settings.json` and `settings.local.json`
  for the same `env` key (a fake server per value, so the request shows which won).
- **P4** — a settings file's `env` beats a shell export of the same variable.
- **P6** — a project's `settings.local.json` read from a linked worktree and from a subfolder:
  which file wins (the main checkout's root, per the docs, except on Windows).
- **P7** — a running session picks up a changed `ANTHROPIC_BASE_URL` in a settings file without a
  restart, and a REMOVED key waits for a restart (GP5 rests on this: `gateway off` would set
  `https://api.anthropic.com` instead of removing the key). Use a long-lived `claude -p` that sends
  two requests apart (or `--input-format stream-json` with two messages), and change the file
  between them.
- **P8** — a project's `env` waits for workspace trust (an untrusted folder's `.claude/settings.json`
  env is not applied): say exactly what a session sees.
- **P9** — the status line command's environment: does it get the session's effective
  `ANTHROPIC_BASE_URL` (so the status line can show the gateway state per project)?
- **P10** — `--settings` carries over to a background session (`claude --bg` with `--settings`, or
  `/bg`): its requests still go where the file says.
- **P12** — no request header names the project (so the router cannot tell projects apart without
  the prefix): log every request header the fake server receives.
- **P13** — signals: what the router sees when a session is cancelled mid-request (Esc / SIGINT to
  `claude -p`): the connection closes; anything else.

P11 (Windows) is out of scope here: write it down as owed.

## How (the pattern: `.claude/research/2026-10-22-l1b-proofs.md`)

- A fake Anthropic server on a free local port (a small Bun script that logs method, path, headers
  and answers a minimal valid Messages response), a throwaway `HOME` and `CLAUDE_CONFIG_DIR`, a fake
  API key, `--strict-mcp-config`, and the settings under test. **Never the live router (port
  20100), never the person's settings files, never this repo's own `.claude/settings*.json`.**
  P1 alone touches the real login, as above.
- Scripts and logs in your job folder's `tmp/`, never in the repo.
- `claude -p` runs: `--model haiku --effort max` (the scout slot is affordable; the agent guard and
  the launch judge want `max` there). Wrap each in `timeout`. Kill every server you start.

## Your files (change nothing else)

- `.claude/research/2026-10-23-r6-proofs.md` (new): one numbered section per proof — the setup,
  the exact command shape (no secrets), what was seen, the verdict (proved / refuted / unclear),
  and what it means for GP2, GP3 and GP5.
- `docs/claude-code-contract.md`: one row per proved or refuted behaviour, in the section where the
  gateway's rows live, with the version (`claude --version`) and how it was proved, in the existing
  rows' style; a refuted docs claim is a row too ("the docs say X; on <version> Y").

## Done-check

1. Every proof has a verdict in the research file; P11 is listed as owed.
2. `bun run check:docs` and `bun run check:neutral` pass (no real paths, user names or org names:
   write `~` and neutral examples).
3. Your review, then your report: the verdicts in one table, and for GP5 a clear yes or no on P7.
