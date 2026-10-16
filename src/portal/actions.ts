/**
 * What a POST to the portal really does. Every one of them runs the command line's own code:
 *
 *   - a slot, the gateway switch, the judge, the fallback, the router restart and the
 *     OmniRoute update go through `runGateway` / `runOmniroute` — the same functions, the
 *     same checks, the same lock, and the same lines, with `print` collecting them;
 *   - `update`, `doctor`, the heavy-job queue and the companions call the modules the CLI
 *     calls, not a copy of them.
 *
 * So a page can never do something the command line would refuse. The one thing the portal
 * adds is the person's own yes: a terminal question cannot be asked from a browser, so the
 * page asks before it sends the POST (`data-confirm` in `views.ts`) and the action takes
 * `yes` for the CLI's own question — which is why each action that restarts or rewrites
 * something is reached only from a confirmed button.
 *
 * Nothing here writes HTML or JSON: it returns lines, and the page shows them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Check, checkLine, type DoctorOptions, doctorChecks } from "../cli/doctor";
import type { CliPaths } from "../cli/paths";
import { runUpdate } from "../cli/update";
import { listModels, probeModel } from "../gateway/backends";
import { type GatewayContext, runGateway } from "../gateway/commands";
import { loadConfigFile, messageOf } from "../gateway/config";
import { testJudgeTarget } from "../gateway/judge-test";
import { isModelSlot, JUDGE_SLOT, MODEL_SLOTS, parseTarget } from "../gateway/targets";
import { runJobCommand } from "../jobs/commands";
import { realMemoryFacts } from "../jobs/memory";
import { companions } from "../machine/companions";
import { type OmnirouteContext, runOmniroute } from "../omniroute/commands";
import { applyAutoMode, autoModeSource } from "../setup/auto-mode";
import { findUserInstall } from "../setup/installed-plugins";
import { withLock } from "../setup/lock";
import type { ManagedEntriesResult } from "../setup/managed-entries";
import { atomicWrite } from "../setup/write";
import { CLAUDE_TIMEOUT_MS, commandContext } from "../update/apply";
import { heldSince, type LastCheck, readLastCheck, updateFiles } from "../update/state";
import type { PortalContext } from "./context";

/**
 * The OmniRoute context every portal action uses: the portal's own network, clock and runner,
 * and no terminal question (`confirm: null` — the page asks instead, and passes `--yes`). The
 * wait after a restart is the probe's own sleep, so a test drives it like the rest of the
 * clock. One home, so a test can build the same context the server builds.
 */
export function portalOmnirouteContext(ctx: PortalContext): OmnirouteContext {
  return {
    confirm: null,
    env: ctx.env,
    health: (url, init) => ctx.fetch(url, init),
    now: ctx.now,
    paths: ctx.paths,
    registry: (url, init) => ctx.fetch(url, init),
    runner: ctx.runner,
    say: () => undefined,
    sleep: (ms) => ctx.probe.sleep(ms),
    systemFolders: ctx.systemFolders,
    systemd: ctx.systemd,
    which: ctx.which,
  };
}

/** What one action found, in lines the page shows. */
export interface ActionResult {
  ok: boolean;
  lines: string[];
  /** `slot.test` only: one result per target, for the chain's own marks. */
  results?: { detail: string; target: string; verdict: "bad" | "blocked" | "good" }[];
}

/** Everything an action is given: the portal's own context, and the CLI's two. */
export interface ActionContext {
  /** The folder the portal was started in: the project its auto-mode rules come from. */
  cwd: string;
  /** What the portal remembers between pages (`portal.json`). */
  memory: PortalMemory;
  omniroute: OmnirouteContext;
  portal: PortalContext;
}

/** The portal's own small state, in the plugin's state folder. */
export interface PortalMemory {
  /** The opus and fable fallback chains, by slot key (`cc-smart-dev-kit-opus`): what the
   * switch turns on again. The slot key, never the family name: the switch reads the same key. */
  fallback: Record<string, string[]>;
  /** The judge chain when it was last saved: what the judge switch turns on again. */
  judge: string[];
  version: 1;
}

export function memoryFile(paths: CliPaths): string {
  return paths.portalStateFile;
}

export function emptyMemory(): PortalMemory {
  return { fallback: {}, judge: [], version: 1 };
}

/** What the file holds, or nothing when it is not there or not readable. */
export function parseMemory(text: string): PortalMemory {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyMemory();
  }
  if (typeof raw !== "object" || raw === null) return emptyMemory();
  const body = raw as { fallback?: unknown; judge?: unknown; version?: unknown };
  if (body.version !== 1) return emptyMemory();
  const judge = Array.isArray(body.judge)
    ? body.judge.filter((entry): entry is string => typeof entry === "string")
    : [];
  const fallback: Record<string, string[]> = {};
  if (typeof body.fallback === "object" && body.fallback !== null) {
    for (const [family, targets] of Object.entries(body.fallback as Record<string, unknown>)) {
      if (Array.isArray(targets)) {
        fallback[family] = targets.filter((entry): entry is string => typeof entry === "string");
      }
    }
  }
  return { fallback, judge, version: 1 };
}

/** The file's text, or nothing: a missing or unreadable one is the default. */
export function readMemory(paths: CliPaths): PortalMemory {
  try {
    return parseMemory(readFileSync(memoryFile(paths), "utf8"));
  } catch {
    return emptyMemory();
  }
}

export function writeMemory(paths: CliPaths, memory: PortalMemory): void {
  atomicWrite(memoryFile(paths), `${JSON.stringify(memory, null, 2)}\n`, 0o600);
}

/** Every line a command printed, collected. A failure's line is kept too: the page shows it. */
function collector(): {
  lines: string[];
  print: (line: string) => void;
  error: (line: string) => void;
} {
  const lines: string[] = [];
  const push = (line: string): void => {
    for (const one of line.split("\n")) if (one.trim() !== "") lines.push(one);
  };
  return { error: push, lines, print: push };
}

/**
 * The gateway commands' context, with `print` collecting instead of the terminal. The router
 * bundle is resolved now, not at startup: the folder this portal started in can be gone (an
 * update) — `{ error }` in words is then the action's whole answer.
 */
function gatewayContext(
  action: ActionContext,
  print: (line: string) => void,
): { ctx: GatewayContext } | { error: string } {
  const { portal } = action;
  const folder = portal.pluginFolder();
  if ("error" in folder) return folder;
  return {
    ctx: {
      bunPath: process.execPath,
      bunVersion: portal.bunVersion,
      bundle: join(folder.folder, "dist", "router.js"),
      confirm: null,
      error: print,
      paths: portal.paths,
      print,
      probe: portal.probe,
      readStdin: () => Promise.resolve(""),
      runner: portal.runner,
      // The portal's own service kind: systemd's units, or a Windows Scheduled Task.
      service: portal.systemd ? "systemd" : "none",
      account: null,
      platform: process.platform,
    },
  };
}

/**
 * Runs a gateway command with the person's yes already given. The plugin's folder is resolved
 * here, at the moment of the action: `gateway setup` reads the router bundle from it, and a
 * folder that is gone is the whole answer, in words.
 */
async function gateway(action: ActionContext, args: string[]): Promise<ActionResult> {
  const { lines, print } = collector();
  const context = gatewayContext(action, print);
  if ("error" in context) return { lines: [context.error], ok: false };
  const code = await runGateway(args, context.ctx);
  return { lines, ok: code === 0 };
}

// ── Slots ───────────────────────────────────────────────────────────────────────

/** The slot argument `gateway slot` takes: the short name, or the key as it is. */
export function slotArg(name: string): string {
  return name.startsWith("cc-smart-dev-kit-") ? name : `cc-smart-dev-kit-${name}`;
}

/**
 * Tests every target of a chain, the way the CLI's checks do, plus one tiny chat to each
 * affordable model — a model list says a model is there, not that it answers.
 *
 *   - a judge target: the force-push test (`gateway slot judge` runs it, and refuses a
 *     target that does not block). Verdict `blocked` or `bad`. A `claude-…` target is the
 *     one exception, exactly as it is for the command line: it cannot be tested from here and
 *     the router never uses it, so it counts as allowed.
 *   - an affordable `<backend>:<model>`: its backend's list must name the model, then one
 *     tiny chat. Verdict `good` or `bad`.
 *   - `claude-…`: no request is possible — the portal has no Claude login, and none may be
 *     given to it. Verdict `good`, with the reason said plainly.
 */
async function testTargets(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const slot = typeof body.slot === "string" ? slotArg(body.slot) : "";
  const targets = Array.isArray(body.targets)
    ? body.targets.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (targets.length === 0) return { lines: ["Give the chain at least one target."], ok: false };
  const config = loadConfigFile(action.portal.paths.gatewayConfigFile);
  const results: ActionResult["results"] = [];
  const lines: string[] = [];
  const judge = slot === JUDGE_SLOT;

  for (const text of targets) {
    const parsed = parseTarget(text);
    if ("error" in parsed) {
      results.push({ detail: parsed.error, target: text, verdict: "bad" });
      continue;
    }
    if (parsed.target.kind === "anthropic") {
      results.push({
        detail: judge
          ? "on your own Claude login: the router uses a judge target only after it passed the force-push test, so this one is ignored, exactly as the command line ignores it"
          : "on your own Claude login: the portal cannot send a request with it, and never holds one",
        target: text,
        verdict: "good",
      });
      lines.push(
        judge
          ? `${text}: on your own Claude login, so it is never used as a judge (the command line allows it too)`
          : `${text}: on your own Claude login`,
      );
      continue;
    }
    const backend = config.backends[parsed.target.backend];
    if (backend === undefined) {
      results.push({
        detail: `backend "${parsed.target.backend}" is not in the config`,
        target: text,
        verdict: "bad",
      });
      continue;
    }
    const listed = await listModels(backend.baseUrl, backend.apiKey, 8_000);
    if ("error" in listed || listed.status !== 200) {
      const why = "error" in listed ? listed.error : `HTTP ${listed.status}`;
      results.push({ detail: `the backend did not answer (${why})`, target: text, verdict: "bad" });
      lines.push(`${text}: ✗ ${why}`);
      continue;
    }
    if (!listed.models.some((model) => model.id === parsed.target.model)) {
      results.push({
        detail: `"${parsed.target.backend}" has no model "${parsed.target.model}"`,
        target: text,
        verdict: "bad",
      });
      lines.push(`${text}: ✗ the backend does not list that model`);
      continue;
    }
    if (judge) {
      const result = await testJudgeTarget(backend.baseUrl, backend.apiKey, parsed.target.model);
      results.push({
        detail: result.detail,
        target: text,
        verdict: result.verdict === "block" ? "blocked" : "bad",
      });
      lines.push(
        result.verdict === "block"
          ? `${text}: blocked the force-push test`
          : `${text}: ✗ it did not block the force-push test (${result.detail})`,
      );
      continue;
    }
    const probe = await probeModel({
      apiKey: backend.apiKey,
      baseUrl: backend.baseUrl,
      fetchImpl: action.portal.fetch,
      model: parsed.target.model,
    });
    results.push({ detail: probe.detail, target: text, verdict: probe.ok ? "good" : "bad" });
    lines.push(`${text}: ${probe.ok ? "✓" : "✗"} ${probe.detail}`);
  }
  const ok = results.every((one) => one.verdict !== "bad");
  // One rule, said exactly: Save is held off for the judge slot alone, because a judge is set
  // only with a chain that passed the force-push test. Another slot's chain is refused by
  // `gateway slot` itself when a target fails, so the page does not claim Save is off there.
  lines.push(
    ok
      ? judge
        ? "Every backend target blocked the test check. You can save this chain."
        : "Every target answered."
      : judge
        ? "At least one backend target did not block the test check: Save stays off until every judge target shows blocked ✓."
        : "At least one target did not answer as it should: the command line refuses a chain like this, so fix it before you save.",
  );
  return { lines, ok, results };
}

/** Saves a chain through `gateway slot`, which also remembers it for the switches. */
async function saveSlot(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const slot = typeof body.slot === "string" ? slotArg(body.slot) : "";
  const targets = Array.isArray(body.targets)
    ? body.targets.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (slot === "" || targets.length === 0)
    return { lines: ["Pick a slot and give it a target."], ok: false };
  const result = await gateway(action, ["slot", slot, targets.join(",")]);
  if (result.ok) rememberChain(action, slot, targets);
  return result;
}

/**
 * A saved chain the switches can turn on again. Only the three that can be off, and always
 * under the **slot key** (`cc-smart-dev-kit-opus`) — the same key `switchFallback` reads and
 * the same key the config uses. Storing it under the family (`opus`) instead was the bug: the
 * switch then found nothing and turned nothing on.
 */
function rememberChain(action: ActionContext, slot: string, targets: string[]): void {
  if (slot === JUDGE_SLOT) action.memory.judge = targets;
  else if (isModelSlot(slot)) action.memory.fallback[slot] = targets;
  else return;
  writeMemory(action.portal.paths, action.memory);
}

/**
 * Remembers the chain the config holds right now for a slot, before a switch turns it off.
 * Without this, a chain set from the command line is lost by one Off: the switch has nothing
 * to turn back on. Read in one go, just before the `off` runs — the `off` itself takes setup's
 * lock (`gateway slot`), so this must not take it again: two locks on one folder wait for each
 * other until the wait runs out.
 */
function rememberCurrent(action: ActionContext, slot: string): string[] {
  const targets = currentChain(action, slot);
  if (targets.length > 0) rememberChain(action, slot, targets);
  return targets;
}

/** The chain the config holds for a slot right now; none when there is none, or no config. */
function currentChain(action: ActionContext, slot: string): string[] {
  try {
    return loadConfigFile(action.portal.paths.gatewayConfigFile).slots[slot] ?? [];
  } catch {
    // No config, or one that cannot be read: there is nothing there.
    return [];
  }
}

// ── Switches ────────────────────────────────────────────────────────────────────

async function switchGateway(action: ActionContext, on: boolean): Promise<ActionResult> {
  return gateway(action, [on ? "on" : "off"]);
}

/**
 * The judge. On only with a chain that is saved and fully force-push-tested: the remembered
 * one, which `gateway slot judge` itself re-tests before it saves (there is no way to skip
 * that test). With nothing remembered, the page is told how to make one.
 */
async function switchJudge(action: ActionContext, on: boolean): Promise<ActionResult> {
  if (!on) {
    rememberCurrent(action, JUDGE_SLOT);
    return gateway(action, ["slot", "judge", "off"]);
  }
  if (action.memory.judge.length === 0) {
    return {
      lines: [
        "No tested judge chain is saved, so the switch cannot turn one on.",
        "Go to Slots, pick judge, add a model, run the force-push test, and Save.",
      ],
      ok: false,
    };
  }
  return gateway(action, ["slot", "judge", action.memory.judge.join(",")]);
}

/**
 * The opus and fable fallback. Off turns both off. On puts the remembered chains back (a
 * model slot needs no test: the CLI checks its model list, and its first target is the
 * Claude model itself). A family with nothing remembered is named, not invented.
 */
async function switchFallback(action: ActionContext, on: boolean): Promise<ActionResult> {
  const slots = Object.keys(MODEL_SLOTS);
  if (!on) {
    // One at a time: each takes setup's state lock, and a second call waiting on it would
    // only make the first wait for the second. The chain each slot holds is remembered first,
    // so On can put it back.
    const lines: string[] = [];
    let ok = true;
    for (const slot of slots) {
      // A slot that is already off is skipped: `gateway slot <key> off` refuses it as an error
      // ("already off"), and the portal only ever asks for what the command line would do.
      if (rememberCurrent(action, slot).length === 0) continue;
      const result = await gateway(action, ["slot", slot, "off"]);
      ok = ok && result.ok;
      lines.push(...result.lines);
    }
    return {
      lines: lines.length === 0 ? ["The opus and fable fallback was already off."] : lines,
      ok,
    };
  }
  const missing: string[] = [];
  const lines: string[] = [];
  let turnedOn = 0;
  let ok = true;
  for (const slot of slots) {
    const targets = action.memory.fallback[slot] ?? [];
    if (targets.length < 2) {
      missing.push(slot.replace(/^cc-smart-dev-kit-/, ""));
      continue;
    }
    const result = await gateway(action, ["slot", slot, targets.join(",")]);
    if (result.ok) turnedOn += 1;
    ok = ok && result.ok;
    lines.push(...result.lines);
  }
  if (missing.length > 0) {
    lines.push(
      `No saved chain for ${missing.join(" or ")}: go to Slots, pick it, add a model, and Save — its first target is the Claude model itself.`,
    );
  }
  if (turnedOn === 0) {
    // Nothing was turned on, so the switch must not read as a success: the page shows these
    // lines in its failure colour, and the switch's own state stays off.
    lines.push("Nothing was turned on, so the switch is still off.");
    return { lines, ok: false };
  }
  return { lines, ok };
}

// ── The rest ────────────────────────────────────────────────────────────────────

/**
 * The hold switch: `cc-smart-dev-kit update --hold` / `--resume`, with their output collected —
 * the CLI's own function, its own words, its own files. A second copy of the hold logic here
 * could only drift from it.
 */
async function switchHold(action: ActionContext, on: boolean): Promise<ActionResult> {
  const sinks = collector();
  const code = await runUpdate(
    action.portal.paths,
    action.portal.env,
    [on ? "--hold" : "--resume"],
    action.portal.now,
    sinks,
  );
  return { lines: sinks.lines, ok: code === 0 };
}

/**
 * A runner that captures a `claude plugin …` step's output instead of printing it on the
 * terminal: the person is looking at the page, not at the terminal that started the portal.
 * It runs in the home folder and without git's repo variables, as the CLI's own does.
 */
function stepRunner(action: ActionContext, lines: string[]) {
  const context = commandContext(action.portal.env, action.portal.paths.home);
  return (argv: string[]): { exitCode: number; output: string } => {
    try {
      const result = Bun.spawnSync(argv, {
        ...context,
        stdin: "ignore",
        stderr: "pipe",
        stdout: "pipe",
        timeout: CLAUDE_TIMEOUT_MS,
      });
      const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
      const last = output.split("\n").at(-1) ?? "";
      if (last !== "") lines.push(`  ${last}`);
      return { exitCode: result.exitCode ?? 1, output };
    } catch (error) {
      return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
    }
  };
}

async function updateCheck(action: ActionContext): Promise<ActionResult> {
  const sinks = collector();
  const code = await runUpdate(
    action.portal.paths,
    action.portal.env,
    ["--check"],
    action.portal.now,
    sinks,
  );
  return { lines: sinks.lines, ok: code === 0 };
}

async function updateInstall(action: ActionContext): Promise<ActionResult> {
  const sinks = collector();
  const code = await runUpdate(action.portal.paths, action.portal.env, [], action.portal.now, {
    ...sinks,
    run: stepRunner(action, sinks.lines),
  });
  return { lines: sinks.lines, ok: code === 0 };
}

/**
 * What one doctor pass runs: the options, built for the plugin's folder **as it is now**, or
 * why it cannot run (the folder is gone — an update during a long run). Building them per pass
 * is the point: the portal runs from a copy, and a path made at startup points at the version
 * folder the update deleted.
 */
export type DoctorSource = () => DoctorOptions | { error: string };

/** Runs the doctor pass, and hands the checks back so the page can store and show them. */
export async function runDoctorPass(
  action: ActionContext,
  source: DoctorSource,
): Promise<{ checks: Check[]; lines: string[]; ok: boolean }> {
  const options = source();
  if ("error" in options) {
    // One failed check, in the page's own shape: what happened, and what to do about it.
    return { checks: [{ ok: false, text: options.error }], lines: [options.error], ok: false };
  }
  const checks = await doctorChecks(action.portal.paths, action.portal.env, options);
  return {
    checks,
    lines: checks.map(checkLine),
    ok: checks.every((check) => check.ok),
  };
}

async function companionEnable(action: ActionContext, id: string): Promise<ActionResult> {
  // The list of the kit's own companions, never any id that merely looks like one: the page
  // sends a JSON body, and a hand-made POST must not be able to enable an arbitrary plugin.
  const known = companions().map((companion) => companion.id);
  if (!known.includes(id)) {
    return {
      lines: [`"${id}" is not one of this kit's companions (${known.join(", ")}).`],
      ok: false,
    };
  }
  const result = action.portal.machine.run(["claude", "plugin", "enable", id]);
  const reason = result.output.trim().split("\n").at(-1) ?? "";
  return result.exitCode === 0
    ? { lines: [`${id} is on.`], ok: true }
    : {
        lines: [
          `claude plugin enable ${id} failed (exit ${result.exitCode})${reason === "" ? "" : `: ${reason}`}`,
        ],
        ok: false,
      };
}

/**
 * Writes the project's auto-mode trust rules into Claude Code's user settings. The page's
 * own confirmation stands in for the terminal question the CLI asks; without it, nothing is
 * written. The whole thing runs under setup's lock, like every other managed write.
 */
async function applyAutoModeAction(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) {
    return { lines: ["The rules were not confirmed, so nothing was written."], ok: false };
  }
  const { portal } = action;
  const wanted = autoModeSource(action.cwd, portal.which);
  if (wanted === null) {
    return {
      lines: ["This folder is not inside a git project, so there is nothing to copy."],
      ok: false,
    };
  }
  if (wanted.entries.length === 0) {
    return { lines: ["This project asks for no auto-mode rules."], ok: false };
  }
  try {
    const lines = await withLock(
      portal.paths.stateDir,
      () =>
        entryLines(applyAutoMode(portal.paths.settingsFile, portal.paths.stateDir, wanted, false)),
      { waitMs: 10_000 },
    );
    return {
      lines: [...lines, "Auto mode reads these from your user settings, the only place it trusts."],
      ok: true,
    };
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

async function omnirouteAction(action: ActionContext, args: string[]): Promise<ActionResult> {
  const { lines, print } = collector();
  const code = await runOmniroute(args, { ...action.omniroute, say: print });
  return { lines, ok: code === 0 };
}

// ── The door ────────────────────────────────────────────────────────────────────

/**
 * Runs one action. `body` is the page's JSON, already parsed; nothing here trusts it — every
 * value is checked, and a value a command would refuse is refused here too.
 *
 * `doctor` is the one action the server runs itself: its result is kept, so the Machine page
 * shows the last pass instead of running one on every load.
 */
export async function runAction(
  name: string,
  body: Record<string, unknown>,
  action: ActionContext,
): Promise<ActionResult> {
  switch (name) {
    case "slot.test":
      return testTargets(action, body);
    case "slot.save":
      return saveSlot(action, body);
    case "switch": {
      const which = typeof body.name === "string" ? body.name : "";
      const on = body.on === true;
      switch (which) {
        case "gateway":
          return switchGateway(action, on);
        case "judge":
          return switchJudge(action, on);
        case "fallback":
          return switchFallback(action, on);
        case "hold":
          return switchHold(action, on);
        default:
          return { lines: [`"${which}" is not a switch.`], ok: false };
      }
    }
    case "update.check":
      return updateCheck(action);
    case "update.install":
      return updateInstall(action);
    case "companion.enable":
      return companionEnable(action, typeof body.id === "string" ? body.id : "");
    case "router.restart":
      return gateway(action, ["setup", "--yes"]);
    case "omniroute.update":
      // No `--to`, ever: the page offers the newest release the registry allows, and a value
      // out of a JSON body must never reach `bun add --global omniroute@<spec>`.
      return omnirouteAction(action, ["update", "--yes"]);
    case "omniroute.rollback":
      return omnirouteAction(action, ["rollback", "--yes"]);
    case "automode.apply":
      return applyAutoModeAction(action, body);
    default:
      return { lines: [`"${name}" is not an action.`], ok: false };
  }
}

/** The heavy-job queue's own lines, for the Machine page. */
export async function jobLines(action: ActionContext): Promise<{ error: string; lines: string[] }> {
  const lines: string[] = [];
  const say: string[] = [];
  try {
    const code = await runJobCommand(["status"], {
      cwd: action.cwd,
      execArgv: process.execArgv,
      memory: realMemoryFacts(),
      paths: action.portal.paths,
      print: (line) => lines.push(line),
      say: (line) => say.push(line),
    });
    return { error: code === 0 ? "" : say.join("\n"), lines };
  } catch (error) {
    return { error: messageOf(error), lines: [] };
  }
}

/** The self-update's own state, read through the same files `doctor` reads. */
export function updateState(action: ActionContext): {
  heldSince: null | string;
  installed: null | string;
  last: LastCheck | null;
} {
  const files = updateFiles(action.portal.paths.stateDir);
  return {
    heldSince: heldSince(files),
    installed: findUserInstall(action.portal.paths.installedPluginsFile)?.version ?? null,
    last: readLastCheck(files),
  };
}

/** One `~` line per entry, in the same words `setup` prints its changes in. */
export function entryLines(result: ManagedEntriesResult): string[] {
  const where = result.file;
  const lines: string[] = [];
  for (const entry of result.added) lines.push(`~ ${where}: added ${JSON.stringify(entry)}`);
  for (const entry of result.removed) lines.push(`~ ${where}: removed ${JSON.stringify(entry)}`);
  for (const entry of result.skipped) {
    lines.push(
      `  ${where}: ${JSON.stringify(entry)} is already in the list, put there by someone else: left alone`,
    );
  }
  return lines.length === 0 ? ["Nothing to change."] : lines;
}
