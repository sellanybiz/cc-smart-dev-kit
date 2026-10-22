/**
 * How the router relays an affordable backend's refusal of a request (a 400 or 422): in a
 * form Claude Code does not send again.
 *
 * Why: since 2.1.304 Claude Code keeps tool search on behind a custom base URL. When a 400
 * or 422 comes back that it does not recognise, on a request that carried deferred tools, it
 * sends the request again without them (every MCP tool loaded up front: about 184K tokens
 * instead of 70K), and the router walks the whole chain a second time. A backend's refusal
 * says nothing about tool search, so the second walk is wasted and costly.
 *
 * What Claude Code does with each form, proved on 2.1.306 with a fake server
 * (docs/claude-code-contract.md):
 *   - a 400 or 422 with an unknown message: sent again without deferred tools;
 *   - a 400 whose message holds "prompt is too long": not sent again, and Claude Code's own
 *     recovery for a long conversation (compaction) takes over;
 *   - a 424: not sent again, not retried, shown as `API Error: 424 <message>`;
 *   - a 404 is retried and read as a model that does not exist, a 413 as too many images.
 * So a refusal that says the conversation is too long goes as the first form, and any other
 * goes as a 424.
 *
 * Pure.
 */

import { COMMAND } from "../build-info/names";

/** The status of a relayed refusal that Claude Code does not send again (see above). */
export const REFUSAL_STATUS = 424;

/**
 * The words of a backend's refusal that say the input is too long for its model. Tighter than
 * the log's hint: the router's answer starts Claude Code's compaction, so a refusal that only
 * mentions a field named `context_management` must not match.
 */
const LENGTH_REFUSAL =
  /too long|too large|too many tokens|token limit|exceeds? (?:the |this )?(?:model'?s? )?(?:maximum )?(?:context|token)|(?:maximum|max) context|context (?:length|window|limit)/i;

/** Does a backend's reason (the start of its answer) say the conversation is too long? */
export function isLengthRefusal(reason: string): boolean {
  return LENGTH_REFUSAL.test(reason);
}

/** Is this a status whose relay needs the refusal form: a 400 or a 422? */
export function isRefusalStatus(status: number): boolean {
  return status === 400 || status === 422;
}

function errorBody(status: number, message: string, headers: Record<string, string>): Response {
  return Response.json(
    { error: { message, type: "invalid_request_error" }, type: "error" },
    { headers, status },
  );
}

/**
 * A backend's refusal of a request, as Claude Code gets it. `reason` is the start of the
 * backend's own answer (keys already masked, a few hundred characters).
 */
export function backendRefusal(label: string, status: number, reason: string): Response {
  if (isLengthRefusal(reason)) {
    return errorBody(
      400,
      `prompt is too long: ${label} refused this conversation as too long for it (HTTP ${status}: ${reason}). Put a target with a larger window first in the slot: ${COMMAND} gateway slot <slot> <targets>`,
      { "x-should-retry": "false" },
    );
  }
  return errorBody(
    REFUSAL_STATUS,
    `cc-smart-dev-kit-router: ${label} refused this request (HTTP ${status}): ${reason}`,
    { "x-should-retry": "false" },
  );
}
