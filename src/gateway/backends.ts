/**
 * The backends' model lists, read with each backend's own key (never a Claude login), and —
 * for a check the person asked for — one tiny chat to a model. Used by `gateway models`,
 * `gateway slot` (to check a target), `gateway status`, `doctor`, the portal's Slots page and
 * the OmniRoute update. A test reaches only a local fake server.
 *
 * The chat's prompt is a fixed word of this module's own: nothing from the conversation, the
 * machine or the person is sent. It is a check that a `<backend>:<model>` answer really
 * answers, which a model list cannot prove — a process can list a model and still fail every
 * request to it.
 */

import { messageOf } from "./config";
import type { HealthFetch } from "./health";
import { directIfLoopback } from "./hosts";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One model a backend lists. */
export interface ListedModel {
  contextLength: null | number;
  id: string;
}

/** The models in an OpenAI- or Anthropic-style `/v1/models` answer. */
export function parseModelList(body: unknown): ListedModel[] {
  if (!isJsonObject(body) || !Array.isArray(body.data)) return [];
  const models: ListedModel[] = [];
  for (const entry of body.data) {
    if (!isJsonObject(entry) || typeof entry.id !== "string") continue;
    const context = entry.context_length;
    models.push({ contextLength: typeof context === "number" ? context : null, id: entry.id });
  }
  return models;
}

/** A backend's `/v1/models`, with its own key; an error in words when it does not answer. */
export async function listModels(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10_000,
  fetchImpl: HealthFetch = (url, init) => fetch(url, init),
): Promise<{ error: string } | { models: ListedModel[]; status: number }> {
  try {
    const url = `${baseUrl}/v1/models`;
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      // The key goes straight to a backend on this machine, never through a proxy.
      ...directIfLoopback(url),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { models: [], status: response.status };
    }
    return { models: parseModelList(await response.json()), status: response.status };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** How long one key check may take. Short on purpose: it is a question, not a job. */
export const KEY_CHECK_TIMEOUT_MS = 5_000;

/**
 * What one backend key check found:
 *   - `accepted`: the backend answered 2xx to an authenticated request, so it took the key;
 *   - `refused`: it answered 401 or 403 — it says the key is not one of its own;
 *   - `unchecked`: it did not answer at all, or answered something else (a 5xx, a 404 on
 *     `/v1/models`). Never a refusal: a backend that is down or different says nothing about
 *     the key, and the caller may save it with an explicit `--save-unchecked`.
 */
export type KeyCheck =
  | { kind: "accepted"; status: number }
  | { detail: string; kind: "refused"; status: number }
  | { detail: string; kind: "unchecked" };

/**
 * Tests one backend key against that backend with ONE cheap authenticated request: `GET
 * /v1/models`, the same call `gateway models` and `doctor` make. This is what stops a wrong key
 * from replacing a working one: a person pasted their Ollama Cloud key where the router's
 * OmniRoute key was asked for, OmniRoute answered 401 to every request after that, and every
 * affordable subagent fell back to Claude until the key was read back out of OmniRoute's own
 * database (live, 2026-10-17).
 *
 * What it cannot prove: a backend that lists its models without checking the key answers 2xx to
 * any key, so a wrong one reads as accepted. The check is a cheap gate, not a proof — the
 * router's own requests are the proof, and `doctor` reports the backend's answer.
 */
export async function checkBackendKey(
  baseUrl: string,
  apiKey: string,
  options: { fetch?: HealthFetch; timeoutMs?: number } = {},
): Promise<KeyCheck> {
  const listed = await listModels(
    baseUrl,
    apiKey,
    options.timeoutMs ?? KEY_CHECK_TIMEOUT_MS,
    options.fetch,
  );
  if ("error" in listed) return { detail: listed.error, kind: "unchecked" };
  if (listed.status >= 200 && listed.status < 300) {
    return { kind: "accepted", status: listed.status };
  }
  if (listed.status === 401 || listed.status === 403) {
    return {
      detail: `/v1/models answered HTTP ${listed.status}: the backend does not accept this key`,
      kind: "refused",
      status: listed.status,
    };
  }
  return { detail: `/v1/models answered HTTP ${listed.status}`, kind: "unchecked" };
}

/** The part of `fetch` the probe needs: the one injectable type (`./health`). */
export type ProbeFetch = HealthFetch;

/** The words of the tiny chat's prompt: our own, and nothing else's. */
export const PROBE_PROMPT = "Reply with one word: ready";

/** How long one step of the check may take. */
export const PROBE_TIMEOUT_MS = 20_000;

/** What one probe found. */
export type ProbeResult = { detail: string; ok: true } | { detail: string; ok: false };

/** The models a backend lists; null when the answer is not the shape expected. */
function modelIds(body: unknown): null | string[] {
  if (!isJsonObject(body) || !Array.isArray(body.data)) return null;
  return body.data
    .map((entry) => (isJsonObject(entry) && typeof entry.id === "string" ? entry.id : null))
    .filter((id): id is string => id !== null);
}

/** The text of the first assistant message in an OpenAI-shaped answer, cut short. */
export function answerText(body: unknown): null | string {
  if (!isJsonObject(body) || !Array.isArray(body.choices)) return null;
  const first = body.choices[0];
  if (!isJsonObject(first) || !isJsonObject(first.message)) return null;
  const content = first.message.content;
  if (typeof content !== "string") return null;
  return content.trim().slice(0, 60);
}

/**
 * The whole model path, in order. Stops at the first failure and says what it was.
 * `model` is the model id the tiny chat goes to (the slot's own id, without its backend).
 */
export async function probeModel(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: ProbeFetch;
  model: null | string;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const { apiKey, baseUrl, fetchImpl } = options;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const listing = `${baseUrl}/v1/models`;
  let models: null | string[];
  try {
    const response = await fetchImpl(listing, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      ...directIfLoopback(listing),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        detail:
          response.status === 401 || response.status === 403
            ? `/v1/models answered HTTP ${response.status}: it does not accept the key in the gateway config`
            : `/v1/models answered HTTP ${response.status}`,
        ok: false,
      };
    }
    models = modelIds(await response.json());
  } catch (error) {
    return { detail: `/v1/models: ${messageOf(error)}`, ok: false };
  }
  if (models === null)
    return { detail: "/v1/models answered something that is not a model list", ok: false };

  const model = options.model;
  if (model === null) {
    return {
      detail: `/v1/models answers, ${models.length} models (no model to try a chat with)`,
      ok: true,
    };
  }
  if (!models.includes(model)) {
    return {
      detail: `/v1/models answers but lists no "${model}": the gateway's slot would fall to its next target`,
      ok: false,
    };
  }
  const chat = `${baseUrl}/v1/chat/completions`;
  try {
    const response = await fetchImpl(chat, {
      body: JSON.stringify({
        messages: [{ content: PROBE_PROMPT, role: "user" }],
        model,
        max_tokens: 8,
      }),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      ...directIfLoopback(chat),
    });
    if (!response.ok) {
      // Its own reason is worth having: it is why the slot would fall to the next target.
      const body = await response.text().catch(() => "");
      return {
        detail: `${model} answered HTTP ${response.status} (${body.trim().slice(0, 120)})`,
        ok: false,
      };
    }
    const answer = answerText(await response.json());
    return {
      detail:
        answer === null
          ? `${model} answered, in a shape this check does not read`
          : `${model} answered "${answer}"`,
      ok: true,
    };
  } catch (error) {
    return { detail: `${model}: ${messageOf(error)}`, ok: false };
  }
}
