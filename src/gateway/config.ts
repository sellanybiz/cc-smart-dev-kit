/**
 * The AI gateway's config file: `~/.config/anymodel/gateway.json`, one per machine.
 *
 * It holds the cheap backends' API keys, so only its owner may read it: a file whose mode
 * lets the group or others read it is refused, never loaded. No Claude credential is ever
 * in it: Claude requests carry the person's own login.
 *
 * The router reads it again when the file changes, so `anymodel gateway slot` switches
 * a slot live. A bad edit keeps the last good config, with one error line.
 *
 * Every function takes the file's path, so the tests run against a temp folder.
 * The design: docs/gateway.md.
 */

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info";
import { isBackendName, isSlotKey, JUDGE_SLOT, parseTarget, withoutContextSuffix } from "./targets";

export const DEFAULT_PORT = 20100;
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_FIRST_BYTE_MS = 60_000;

/** What both slots answer on while there is no good config file. */
const FALLBACK_SLOT_TARGET = "claude-sonnet-5-5";

/** The log's words for running on `emptyConfig()`. */
const NO_CONFIG_MEANS = `every haiku / sonnet call answers on ${FALLBACK_SLOT_TARGET} (your own Claude login) until it is fixed`;

/** An http(s) URL, without the trailing slash, so `base + "/v1/messages"` is clean. */
const baseUrl = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ""));

const backendSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl,
});

export const gatewayConfigSchema = z
  .object({
    /**
     * Old model names and what they mean now: `{"<old name>": "<slot or target>"}`. The
     * router resolves an alias before it routes. The plugin ships none; a project's own
     * migration writes them, so a machine's old names keep working while it moves.
     */
    aliases: z.record(z.string(), z.string()).default({}),
    // Only Anthropic: Claude requests carry the person's own login, so no config edit may
    // point them anywhere else. (Tests inject a fake through the router.)
    anthropicBaseUrl: z.literal(DEFAULT_ANTHROPIC_BASE_URL).default(DEFAULT_ANTHROPIC_BASE_URL),
    backends: z.record(z.string().refine(isBackendName, "not a backend name"), backendSchema),
    port: z.int().min(1).max(65_535).default(DEFAULT_PORT),
    slots: z.record(
      z.string().refine(isSlotKey, "a slot key is anymodel-<name>"),
      z.array(z.string()).min(1),
    ),
    timeouts: z
      .object({ firstByteMs: z.int().positive().default(DEFAULT_FIRST_BYTE_MS) })
      .default({ firstByteMs: DEFAULT_FIRST_BYTE_MS }),
    version: z.literal(1),
  })
  .superRefine((config, ctx) => {
    for (const [slot, targets] of Object.entries(config.slots)) {
      targets.forEach((text, index) => {
        const parsed = parseTarget(text);
        if ("error" in parsed) {
          ctx.addIssue({ code: "custom", message: parsed.error, path: ["slots", slot, index] });
        } else if (slot === JUDGE_SLOT && parsed.target.kind === "anthropic") {
          // The check's body is built for the model it names: Claude Sonnet 5.5 answers
          // 400 to its `thinking: disabled`, and auto mode would approve nothing.
          ctx.addIssue({
            code: "custom",
            message: `${JUDGE_SLOT} takes no claude-… target; use "${COMMAND} gateway slot judge off" to put the checks on Claude`,
            path: ["slots", slot, index],
          });
        } else if (
          parsed.target.kind === "backend" &&
          !Object.hasOwn(config.backends, parsed.target.backend)
        ) {
          ctx.addIssue({
            code: "custom",
            message: `"${text}" names backend "${parsed.target.backend}", which is not in backends`,
            path: ["slots", slot, index],
          });
        }
      });
    }
    for (const [name, to] of Object.entries(config.aliases)) {
      const error = aliasError(name, to, config);
      if (error !== null) ctx.addIssue({ code: "custom", message: error, path: ["aliases", name] });
    }
  });

/**
 * Why an alias cannot be used, or null when it can. An alias names a slot or a target,
 * never another alias: so the router resolves each name in one step, and a loop
 * (`a` → `b` → `a`, or `a` → `a`) cannot exist.
 */
function aliasError(
  name: string,
  to: string,
  config: { aliases: Record<string, string>; backends: Record<string, unknown>; slots: object },
): null | string {
  if (name.trim() === "" || /\s/.test(name)) return `alias "${name}" is not a model name`;
  if (withoutContextSuffix(name) !== name) {
    return `alias "${name}": write it without [1m]; the router looks names up without it`;
  }
  // A claude-… request goes to Anthropic untouched, on the own login: no alias moves it.
  if (name.startsWith("claude-")) return `alias "${name}": a claude-… name cannot be an alias`;
  if (Object.hasOwn(config.slots, name)) {
    return `alias "${name}" has the name of a slot; a slot cannot be an alias too`;
  }
  if (Object.hasOwn(config.aliases, to)) {
    return `alias "${name}" points at "${to}", which is an alias too; point it at a slot or a model`;
  }
  if (isSlotKey(to)) {
    return Object.hasOwn(config.slots, to)
      ? null
      : `alias "${name}" points at slot "${to}", which is not in slots`;
  }
  const parsed = parseTarget(to);
  if ("error" in parsed) return `alias "${name}": ${parsed.error}`;
  if (parsed.target.kind === "backend" && !Object.hasOwn(config.backends, parsed.target.backend)) {
    return `alias "${name}" names backend "${parsed.target.backend}", which is not in backends`;
  }
  return null;
}

export type GatewayConfig = z.output<typeof gatewayConfigSchema>;

/** The words of a caught error, whatever was thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A config file that cannot be used, with the reason in words. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Check a parsed value against the schema; the reason in words when it fails. */
export function parseConfig(raw: unknown): { config: GatewayConfig } | { error: string } {
  const result = gatewayConfigSchema.safeParse(raw);
  return result.success ? { config: result.data } : { error: z.prettifyError(result.error) };
}

/**
 * Read and check the config file. Throws a ConfigError when the file is missing, readable
 * by the group or others, not JSON, or not a valid config. The error never quotes the
 * file's text: it holds API keys.
 */
export function loadConfigFile(path: string): GatewayConfig {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
  }
  if ((mode & 0o077) !== 0) {
    throw new ConfigError(
      `${path} can be read by other users (mode ${(mode & 0o777).toString(8)}); it holds API keys. Run: chmod 600 ${path}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // Not the parser's message: it can quote the text around the mistake, a key included.
    throw new ConfigError(`${path} is not valid JSON. Fix it by hand.`, { cause: error });
  }
  const parsed = parseConfig(raw);
  if ("error" in parsed)
    throw new ConfigError(`${path} is not a valid gateway config:\n${parsed.error}`);
  return parsed.config;
}

/**
 * Write a file so no reader ever sees half of it: a temp file in the same folder (same
 * disk, so the rename is atomic), with its mode set before any byte is in it, then a
 * rename over the old one.
 */
export function writeFileAtomic(path: string, text: string, mode: number): void {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, text, { flag: "wx", mode });
    // The umask can only remove bits from `mode`; set it exactly anyway.
    chmodSync(temp, mode);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Save a config: checked first, folder made owner-only, file mode 600, atomic. */
export function saveConfig(path: string, config: GatewayConfig): void {
  const parsed = parseConfig(config);
  if ("error" in parsed)
    throw new ConfigError(`refusing to save an invalid config:\n${parsed.error}`);
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  writeFileAtomic(path, `${JSON.stringify(parsed.config, null, 2)}\n`, 0o600);
}

/**
 * The config the router runs on while the file is missing or bad at start: no backends,
 * and both slots on Claude Sonnet 5.5 (1M context, like the `[1m]` the slot names
 * announce) on the person's own login. So every haiku / sonnet call still answers, only
 * not cheaply. Better than a service that crash-loops, or a 400 on every subagent, for
 * every Claude Code session on the machine.
 */
export function emptyConfig(): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: {},
    port: DEFAULT_PORT,
    slots: {
      "anymodel-scout": [FALLBACK_SLOT_TARGET],
      "anymodel-worker": [FALLBACK_SLOT_TARGET],
    },
    timeouts: { firstByteMs: DEFAULT_FIRST_BYTE_MS },
    version: 1,
  };
}

/** The live config, read again whenever the file changes. */
export interface ConfigSource {
  get(): GatewayConfig;
  /** False while the router runs on `emptyConfig()` because no good file was ever read. */
  loaded(): boolean;
}

/** What `watchConfig` needs from the file system; a test passes its own. */
export interface WatchDeps {
  load: (path: string) => GatewayConfig;
  stat: (path: string) => { ctimeMs: number; mode: number; mtimeMs: number; size: number };
}

const REAL_WATCH_DEPS: WatchDeps = { load: loadConfigFile, stat: statSync };

/**
 * The config, checked against the file's stamp (modification and change time, size,
 * mode) on every `get()`: one `stat` per request, nothing next to an upstream call. (Not
 * `fs.watch`: saving by rename replaces the file, and a watcher on the old one goes
 * quiet.) A changed file is loaded; a bad or missing one keeps the last good config
 * (`emptyConfig()` when there never was one) and logs ONE error until the file changes
 * again.
 */
export function watchConfig(
  path: string,
  log: (line: string) => void,
  deps: WatchDeps = REAL_WATCH_DEPS,
): ConfigSource {
  let current = emptyConfig();
  let good = false;
  let seen: null | string = null;

  const refresh = () => {
    let stamp: string;
    try {
      const stats = deps.stat(path);
      // `mode` and `ctimeMs` too: a `chmod 600` alone changes neither mtime nor size, and
      // must still bring a refused file in.
      stamp = `${stats.mtimeMs}:${stats.size}:${stats.mode}:${stats.ctimeMs}`;
    } catch (error) {
      const gone = `gone:${messageOf(error)}`;
      if (gone !== seen) {
        log(
          `ERROR config ${path} cannot be read (${messageOf(error)}); ${good ? "keeping the last good config" : NO_CONFIG_MEANS}`,
        );
      }
      seen = gone;
      return;
    }
    if (stamp === seen) return;
    seen = stamp;
    try {
      current = deps.load(path);
      if (good) log(`config reloaded from ${path}`);
      good = true;
    } catch (error) {
      log(`ERROR ${messageOf(error)}\n${good ? "keeping the last good config" : NO_CONFIG_MEANS}`);
    }
  };

  refresh();
  return {
    get() {
      refresh();
      return current;
    },
    loaded: () => good,
  };
}
