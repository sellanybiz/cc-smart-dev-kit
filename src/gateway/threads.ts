/**
 * Message threads (Claude Code 2.1.310, beta header `message-threads-2026-08-12`; the shapes
 * and how they were proved are in `docs/claude-code-contract.md` § The gateway).
 *
 * With threads on, a normal turn is a "continue": the body holds
 * `thread: { type: "continue", previous_message_id: "msg_…" }`, only the messages after the
 * last assistant message, only the per-turn `system` blocks, and no `tools` when they did not
 * change. Anthropic keeps the rest on its side. A backend cannot: it would answer 200 as if
 * the conversation had just begun (no history, no tools, no system prompt).
 *
 * Claude Code decides once, at a session's first main request, whether to use threads, and
 * a session that started with the gateway off can have them on. When the person turns the
 * gateway on mid-session, the URL changes and that answer does not. So a backend is never
 * sent a continue: the router answers the request itself with the 400 Claude Code's own
 * recovery reads (`error.details.error_code`), and Claude Code resends the turn whole, with no
 * `thread`, once for the model and the session. A `create` body is a whole request: it goes
 * on as it is, and so does every request to an Anthropic target.
 *
 * Pure.
 */

/** The `error.details.error_code` that makes Claude Code resend a turn without a thread. */
export const THREAD_UNSUPPORTED_CODE = "thread_unsupported_request";

/** What the 400 says, for a person reading a log; Claude Code reads the code above. */
const THREAD_REFUSAL_MESSAGE =
  "cc-smart-dev-kit-router: this gateway target keeps no thread: resend the whole conversation";

/**
 * The router's own answer to a request that is a thread continue, or null when the body is
 * not one (no `thread`, a `create`, a `thread` that is no object). The router asks it only
 * for a backend target; an Anthropic target gets the request as it is.
 */
export function threadContinueRefusal(body: Record<string, unknown>): Response | null {
  const thread = body.thread;
  if (typeof thread !== "object" || thread === null || Array.isArray(thread)) return null;
  if ((thread as { type?: unknown }).type !== "continue") return null;
  return Response.json(
    {
      error: {
        details: { error_code: THREAD_UNSUPPORTED_CODE },
        message: THREAD_REFUSAL_MESSAGE,
        type: "invalid_request_error",
      },
      type: "error",
    },
    { status: 400 },
  );
}
