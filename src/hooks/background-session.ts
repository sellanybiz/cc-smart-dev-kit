/**
 * A background session: a Claude Code session started outside a terminal, which a person
 * watches in agent view (`claude agents`), the list of running and finished sessions.
 *
 * Claude Code sets `CLAUDE_JOB_DIR` in each such session (its environment-variables page,
 * code.claude.com/docs/en/env-vars, read 2026-10-18). The session inherits the environment
 * of the daemon that started it — a `DISPLAY` of a remote desktop the person is not looking
 * at, the `WARP_*` pair of a Warp window it did not start in — so an alert of its own goes
 * to the wrong place. Agent view alerts for the session itself while the list is open
 * (Claude Code raises its `Notification` hooks in the list's process: `agent_needs_input`
 * and `agent_completed`, `docs/claude-code-contract.md`).
 *
 * So a background session shows no alert of its own: the notifier and the usage-limit alert
 * both stay silent there, and agent view is the one place its alerts come from. The trade-off
 * the owner accepted (2026-10-18): with no agent view open anywhere, a background session
 * does not alert.
 */

import type { Env } from "./run";

/** True when this session runs in the background: Claude Code set `CLAUDE_JOB_DIR`. */
export function inBackgroundSession(env: Env): boolean {
  return (env.CLAUDE_JOB_DIR ?? "") !== "";
}
