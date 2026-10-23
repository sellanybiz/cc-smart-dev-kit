/**
 * A crew session's context window: the number its hand-off share is measured against, and the
 * one home for it.
 *
 * Three sources, in order:
 *   1. **Claude Code's own number**, when the status line recorded one for this model
 *      (`<stateDir>/context-window.json`): the status line input's
 *      `context_window.context_window_size`, with the input's `model.id`, kept as reported
 *      (`docs/claude-code-contract.md`). A crew session is a `--bg` run with no footer, so it
 *      may never run a status line of its own: the number is whichever session on this machine
 *      ran one for that model, and with none the table below decides. A key is the id exactly
 *      as reported, `[1m]` included: one id can have two windows, and merging the keys would
 *      let one session's size measure another's.
 *   2. **The kit's table** (`WINDOW_1M_SINCE`): keyed by family and the version that family's
 *      1M window starts at, never by one exact id, so a newer model of a family needs no change
 *      here. `[1m]` on any id is 1M, as Claude Code reads it. A Claude id the kit cannot place
 *      gets the smaller guess: a crew session hands off early, never late.
 *   3. **A backend's own list**, for a bare model name a router answer recorded
 *      (`deepseek-v4.1-flash`): the window is that backend's `/v1/models` `context_length` for
 *      the target of the model, whose slot chain the gateway config names. The target may name
 *      the model with its provider (`ollama-cloud/deepseek-v4.1-flash`), which the answer leaves
 *      out: its last `/` segment names it too. The list is read once and kept, and only for the
 *      models a chain names (`<stateDir>/backend-windows.json`) — never one network call per poll.
 *
 * Anything else has an unknown window: no percentage, and so no context hand-off line (the
 * time lines still apply). `windowWatch` is what `crew self-watch` reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CliPaths } from "../cli/paths";
import { type ListedModel, listModels } from "../gateway/backends";
import type { GatewayConfig } from "../gateway/config";
import {
  CLAUDE_FAMILIES,
  type ClaudeFamily,
  claudeFamily,
  claudeVersion,
  isClaudeModelId,
  parseTarget,
  versionAtLeast,
} from "../gateway/targets";
import { gatewayConfigOf } from "../hooks/agent-guard";
import { writeStoreFile } from "./store";

/** The 1M window every Claude family has from `WINDOW_1M_SINCE` on, in tokens. */
export const CONTEXT_WINDOW_1M = 1_000_000;

/** The smaller window: Haiku 4.5, the older models, and the guess for an id the kit cannot place. */
export const CONTEXT_WINDOW_SMALL = 200_000;

/**
 * The version each family's 1M window starts at, from Anthropic's model table (the `claude-api`
 * skill's cached list, 2026-10-06; checked again 2026-10-23): Fable 5 and later, Opus 4.6 and
 * later, Sonnet 4.6 and later, Haiku 5.5. Haiku 4.5 and everything older has 200 000.
 */
export const WINDOW_1M_SINCE: Readonly<Record<ClaudeFamily, { major: number; minor: number }>> = {
  fable: { major: 5, minor: 0 },
  haiku: { major: 5, minor: 5 },
  opus: { major: 4, minor: 6 },
  sonnet: { major: 4, minor: 6 },
};

/**
 * The window of `model` from the kit's own table, in tokens; null for anything that is not a
 * Claude model (a backend's bare model name, a slot key). A Claude model — an id
 * (`claude-opus-5-5`), or the family name a crew session is launched with (`opus`) — has the
 * window `WINDOW_1M_SINCE` gives its family and version, or 1M with the `[1m]` suffix.
 *
 * A model this table does not place is guessed at the smaller window, so a crew session hands
 * off early, never late; every current family is placed, so none of them is guessed at 200 000.
 */
export function contextWindowOf(model: string): null | number {
  const name = model.trim().toLowerCase();
  // Claude Code reads `[1m]` on any id as 1M (and strips the suffix before it sends).
  if (name.endsWith("[1m]")) return CONTEXT_WINDOW_1M;
  // A family name alone names that family's current model, and every current family has 1M.
  if ((CLAUDE_FAMILIES as readonly string[]).includes(name)) return CONTEXT_WINDOW_1M;
  const family = claudeFamily(name);
  if (family === null) return isClaudeModelId(name) ? CONTEXT_WINDOW_SMALL : null;
  const version = claudeVersion(name);
  if (version === null) return CONTEXT_WINDOW_SMALL;
  return versionAtLeast(version, WINDOW_1M_SINCE[family])
    ? CONTEXT_WINDOW_1M
    : CONTEXT_WINDOW_SMALL;
}

/** The file the status line records Claude Code's own window in, one entry per model. */
export function claudeWindowFile(paths: CliPaths): string {
  return join(paths.stateDir, "context-window.json");
}

/** The reading as stored; loose, so a field a newer kit adds stays. */
const claudeStoredSchema = z.record(
  z.string(),
  z.looseObject({ readAt: z.string(), size: z.int().positive() }),
);

/** Every kept reading: `<model>` → `{ readAt, size }`; empty when there is none or it cannot be read. */
function readClaudeStored(file: string): Record<string, { readAt: string; size: number }> {
  if (!existsSync(file)) return {};
  try {
    const parsed = claudeStoredSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The model and the window a status line input reports; null when it reports none (no
 * `model.id`, or no positive `context_window.context_window_size`).
 */
export function claudeWindowOfInput(input: unknown): null | { model: string; size: number } {
  if (!isJsonObject(input)) return null;
  const model = isJsonObject(input.model) ? input.model.id : undefined;
  const context = isJsonObject(input.context_window)
    ? input.context_window.context_window_size
    : undefined;
  if (typeof model !== "string" || model.trim() === "") return null;
  if (typeof context !== "number" || !Number.isInteger(context) || context <= 0) return null;
  // The id as reported, `[1m]` included: one id can have two windows (`claude-opus-4-5` and
  // `claude-opus-4-5[1m]`), and a key that merged them would let one session's size measure
  // the other's.
  return { model: model.trim().toLowerCase(), size: context };
}

/**
 * Records the window Claude Code reported for a model: nothing when the input reports none,
 * and nothing when the number is the one already kept. A model's window is a property of the
 * model, so a reading stays until another one replaces it. A write that fails throws; the
 * status line catches it and prints one line.
 */
export function recordClaudeWindow(paths: CliPaths, input: unknown, nowMs: number): void {
  const reading = claudeWindowOfInput(input);
  if (reading === null) return;
  const file = claudeWindowFile(paths);
  const stored = readClaudeStored(file);
  if (stored[reading.model]?.size === reading.size) return;
  writeStoreFile(
    file,
    `${JSON.stringify(
      {
        ...stored,
        [reading.model]: { readAt: new Date(nowMs).toISOString(), size: reading.size },
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * The window Claude Code reported for `model` — the id exactly as reported, `[1m]` included —
 * or null when it reported none.
 */
export function claudeWindowSaid(paths: CliPaths, model: string): null | number {
  const name = model.trim().toLowerCase();
  return readClaudeStored(claudeWindowFile(paths))[name]?.size ?? null;
}

/** How long a backend's kept model list is used before it is read again. */
export const BACKEND_LIST_TTL_MS = 24 * 60 * 60_000;

/** How long a watch waits before it asks a backend again after its list did not answer. */
export const BACKEND_LIST_RETRY_MS = 10 * 60_000;

/** How long one model-list call may take. Short on purpose: it is a poll of a monitor. */
export const BACKEND_LIST_TIMEOUT_MS = 5_000;

/** The file the backends' last model lists are kept in, one entry per backend. */
export function backendWindowsFile(paths: CliPaths): string {
  return join(paths.stateDir, "backend-windows.json");
}

/** What one backend's kept list holds: when it was read (ms), and each model's window. */
export interface KeptWindows {
  readAtMs: number;
  windows: Record<string, number>;
}

const keptSchema = z.record(
  z.string(),
  z.looseObject({
    readAtMs: z.number(),
    windows: z.record(z.string(), z.number().positive()),
  }),
);

/** Every kept list: `<backend>` → `{ readAtMs, windows }`; empty when there is none or it cannot be read. */
function readKept(paths: CliPaths): Record<string, KeptWindows> {
  const file = backendWindowsFile(paths);
  if (!existsSync(file)) return {};
  try {
    const parsed = keptSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Keeps one backend's list under the others, whole. */
function writeKept(paths: CliPaths, backend: string, list: KeptWindows): void {
  const kept = { ...readKept(paths), [backend]: list };
  writeStoreFile(backendWindowsFile(paths), `${JSON.stringify(kept, null, 2)}\n`);
}

/**
 * Does the bare model name in a transcript name this target's model? An answer records the
 * model without the backend's prefix, and OmniRoute answers with the catalog id minus its
 * provider: a `omniroute:ollama-cloud/deepseek-v4.1-flash` target is answered as
 * `deepseek-v4.1-flash` (measured on this machine, 2026-10-23). So the last `/` or `:` segment
 * names it too.
 */
function namesModel(targetModel: string, name: string): boolean {
  if (targetModel === name) return true;
  const at = Math.max(targetModel.lastIndexOf("/"), targetModel.lastIndexOf(":"));
  return at !== -1 && targetModel.slice(at + 1) === name;
}

/**
 * The windows a backend's list gives the models a chain names: an exact catalog id first, and
 * then the target whose model part is the bare name the answer records. A target that is only a
 * bare name can match the same name under two providers' entries, and nothing says which one
 * answered: those take the smallest window, so a crew session hands off early, never late.
 */
export function windowsFrom(
  models: readonly ListedModel[],
  wanted: ReadonlySet<string>,
): Record<string, number> {
  const windows: Record<string, number> = {};
  const usable = models.filter(
    (one): one is ListedModel & { contextLength: number } =>
      one.contextLength !== null && one.contextLength > 0,
  );
  for (const one of usable) {
    if (wanted.has(one.id)) windows[one.id] = one.contextLength;
  }
  for (const model of wanted) {
    if (windows[model] !== undefined) continue;
    let found: null | number = null;
    for (const candidate of usable) {
      if (!namesModel(candidate.id, model) && !namesModel(model, candidate.id)) continue;
      found = found === null ? candidate.contextLength : Math.min(found, candidate.contextLength);
    }
    if (found !== null) windows[model] = found;
  }
  return windows;
}

/** Every slot target's model part: what the kept lists hold windows for, and nothing else. */
function targetModels(config: GatewayConfig): Set<string> {
  const models = new Set<string>();
  for (const targets of Object.values(config.slots)) {
    for (const text of targets) {
      const parsed = parseTarget(text);
      if ("target" in parsed && parsed.target.kind === "backend") models.add(parsed.target.model);
    }
  }
  return models;
}

/**
 * The backend target that answers with `model`, from the gateway config's slot chains: the
 * bare model name a router answer records is a target's model part without its backend and,
 * for a catalog id, without its provider. Null when no chain names it. The first chain that
 * does wins: two targets serving one bare name may list different windows, and nothing in a
 * transcript says which of them answered.
 */
export function backendForModel(
  config: GatewayConfig,
  model: string,
): null | { backend: string; model: string } {
  const name = model.trim();
  for (const targets of Object.values(config.slots)) {
    for (const text of targets) {
      const parsed = parseTarget(text);
      if (
        "target" in parsed &&
        parsed.target.kind === "backend" &&
        namesModel(parsed.target.model, name)
      ) {
        return { backend: parsed.target.backend, model: parsed.target.model };
      }
    }
  }
  return null;
}

/**
 * The backend a whole target names (`omniroute:ollama-cloud/deepseek-v4.1-flash`), when that
 * backend is in the config. A crew session's record holds its target until the first reply's
 * model stands in for it; a backend it does not know is no target here.
 */
function explicitBackend(
  config: GatewayConfig,
  target: string,
): null | { backend: string; model: string } {
  const parsed = parseTarget(target.trim());
  return "target" in parsed &&
    parsed.target.kind === "backend" &&
    Object.hasOwn(config.backends, parsed.target.backend)
    ? { backend: parsed.target.backend, model: parsed.target.model }
    : null;
}

/** What a window watch reads: the paths, and the one model-list call (a test hands in its own). */
export interface WindowDeps {
  list?: typeof listModels;
  paths: CliPaths;
}

/** The window of a model, at a moment. */
export interface WindowWatch {
  /** The window of `model` now, or null when the kit cannot know it. */
  of: (model: string, nowMs: number) => Promise<null | number>;
}

/**
 * What `crew self-watch` reads its window from, keeping what it learns between polls: the
 * gateway config once, and a backend not asked again for `BACKEND_LIST_RETRY_MS` after its
 * list did not answer. Never throws: the gauge must not stop the monitor.
 */
export function windowWatch(deps: WindowDeps): WindowWatch {
  const list = deps.list ?? listModels;
  let config: GatewayConfig | null | undefined;
  const failedAtMs = new Map<string, number>();
  return {
    async of(model, nowMs) {
      const said = claudeWindowSaid(deps.paths, model);
      if (said !== null) return said;
      const table = contextWindowOf(model);
      if (table !== null) return table;
      config ??= gatewayConfigOf(deps.paths);
      if (config === null) return null;
      // A bare model name is what a reply records; before the first reply the crew session's
      // record holds the whole target it was launched on (`omniroute:<model>`).
      const target = backendForModel(config, model) ?? explicitBackend(config, model);
      if (target === null) return null;
      const kept = readKept(deps.paths)[target.backend];
      const known = kept?.windows[target.model] ?? null;
      if (kept !== undefined && nowMs - kept.readAtMs < BACKEND_LIST_TTL_MS) return known;
      const failedAt = failedAtMs.get(target.backend);
      if (failedAt !== undefined && nowMs - failedAt < BACKEND_LIST_RETRY_MS) return known;
      const backend = config.backends[target.backend];
      if (backend === undefined) return known;
      let listed: Awaited<ReturnType<typeof list>>;
      try {
        listed = await list(backend.baseUrl, backend.apiKey, BACKEND_LIST_TIMEOUT_MS);
      } catch {
        failedAtMs.set(target.backend, nowMs);
        return known;
      }
      if ("error" in listed || listed.status < 200 || listed.status > 299) {
        failedAtMs.set(target.backend, nowMs);
        return known;
      }
      // Only the models a chain names (and this one) are kept: a backend may list thousands,
      // and the file is read at every poll.
      const wanted = targetModels(config);
      wanted.add(target.model);
      const windows = windowsFrom(listed.models, wanted);
      // An answer that names none of them (a catalog loading, or a 200 that is no list) is no
      // reading: kept, it would leave the gauge blind until the kept list was a day old.
      if (Object.keys(windows).length === 0) {
        failedAtMs.set(target.backend, nowMs);
        return known;
      }
      try {
        writeKept(deps.paths, target.backend, { readAtMs: nowMs, windows });
      } catch {
        // The reading stands for this poll; the next one asks again (the list was not kept).
      }
      return windows[target.model] ?? known;
    },
  };
}
