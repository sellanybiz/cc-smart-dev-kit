/**
 * The backends' model lists, read with each backend's own key (never a Claude login).
 * Used by `gateway models`, `gateway slot` (to check a target), `gateway status` and
 * `doctor`. A test reaches only a local fake server.
 */

import { messageOf } from "./config";
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
): Promise<{ error: string } | { models: ListedModel[]; status: number }> {
  try {
    const url = `${baseUrl}/v1/models`;
    const response = await fetch(url, {
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
