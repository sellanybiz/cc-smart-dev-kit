/**
 * The page's requests to the portal server: a GET for each `/api/…` answer, and the POST of
 * an action. Same origin only, with nothing the browser does not send by itself: the door is
 * the server's (`Host`, `Origin`, `Sec-Fetch-Site`), and a POST carries the CSRF value the
 * server wrote into the page (`<meta name="ccsdk-csrf">`).
 */

import type { ActionName, ActionResult } from "./wire";

/** The header a POST carries the page's CSRF value in (`CSRF_HEADER`, `src/portal/guard.ts`). */
export const CSRF_HEADER = "x-ccsdk-csrf";

/** The CSRF value the server wrote into this page; null on a page it did not serve. */
export function csrfToken(): null | string {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="ccsdk-csrf"]')?.getAttribute("content") ?? null;
}

/** A refusal or a failure, in the server's own words when it gave some. */
export class PortalRequestError extends Error {
  override name = "PortalRequestError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The fetch the client uses: the browser's, or a test's. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The words for an answer that is not a success. */
async function failureOf(response: Response, what: string): Promise<PortalRequestError> {
  let words = "";
  try {
    const text = await response.text();
    try {
      const body: unknown = JSON.parse(text);
      if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record.error === "string") words = record.error;
        else if (Array.isArray(record.lines)) words = record.lines.map(String).join(" ");
      }
    } catch {
      words = text.trim().slice(0, 300);
    }
  } catch {
    // No body to read: the status says enough.
  }
  if (response.status === 403) {
    // The door refused it: this page was not served by this portal, or another site sent it.
    return new PortalRequestError(
      `The portal refused ${what} (403). Open the portal from its own address and try again.`,
      403,
    );
  }
  return new PortalRequestError(
    `${what} failed: ${words === "" ? `HTTP ${response.status}` : words}`,
    response.status,
  );
}

/** `GET <path>` as JSON. A network failure says the portal did not answer, in words. */
export async function getJson<T>(fetchImpl: Fetch, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new PortalRequestError("The portal did not answer. Is it still running?", 0);
  }
  if (!response.ok) throw await failureOf(response, `Reading ${path}`);
  return (await response.json()) as T;
}

/**
 * `POST /api/<action>` with the page's CSRF value. The server answers a refusal of the
 * action's own (a bad input, a command that failed) with its lines and `ok: false`: that is a
 * result to show, not an error. Only a refusal at the door or no answer at all throws.
 */
export async function postAction(
  fetchImpl: Fetch,
  action: ActionName,
  body: Record<string, unknown>,
  csrf: null | string,
): Promise<ActionResult> {
  if (csrf === null) {
    throw new PortalRequestError(
      "This page has no CSRF value, so it cannot change anything. Open it from the portal's own address.",
      0,
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(`/api/${action}`, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json", [CSRF_HEADER]: csrf },
      method: "POST",
    });
  } catch {
    throw new PortalRequestError("The portal did not answer. Is it still running?", 0);
  }
  if (response.status === 200 || response.status === 400) {
    const answer: unknown = await response.json().catch(() => null);
    if (
      typeof answer === "object" &&
      answer !== null &&
      typeof (answer as ActionResult).ok === "boolean" &&
      Array.isArray((answer as ActionResult).lines)
    ) {
      return answer as ActionResult;
    }
  }
  throw await failureOf(response, `The action ${action}`);
}
