/**
 * What a POST to the portal really does. Every one of them runs the command line's own code:
 *
 *   - a slot, its fallback switch, the gateway switch, the judge, the opus and fable slots,
 *     the router restart and the
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
import { browserSetup, realBrowserSetupDeps } from "../browser/setup";
import {
  parseBrowserToken,
  readBrowserToken,
  tokenSavedLine,
  writeBrowserToken,
} from "../browser/token";
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
import { isObject } from "../setup/managed-json";
import { atomicWrite } from "../setup/write";
import { CLAUDE_TIMEOUT_MS, commandContext } from "../update/apply";
import { heldSince, type LastCheck, readLastCheck, updateFiles } from "../update/state";
import type { PortalContext } from "./context";
import {
  type ProjectDefaultsReader,
  projectFilesHash,
  projectFileTexts,
  readProject,
  settingsLineNote,
} from "./facts";
import { parseSettingValue, settingSpec } from "./settings";
import type { ProjectInitAnswers, ProjectInitPlan, WorkflowAdapter } from "./workflow-adapter";

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
  /**
   * How the page shows the lines. `"info"`: a fact, not a failure — the token field's
   * "nothing was pasted, so the saved token is unchanged" is the one case. Left out, a
   * refusal is an alarm, as every other one is.
   */
  tone?: "info";
  /**
   * `project.preview` only: the plan the Project card's boxes draw — the same pure
   * `planProjectInit` the write runs, so what the page shows is exactly what will be written.
   */
  preview?: ProjectInitPlan;
  /**
   * `project.preview` only: `projectFilesHash` of the two texts that plan was made against.
   * The page sends it back with the write, which refuses to run on a plan that no longer
   * matches the files on disk.
   */
  filesHash?: string;
  /** `slot.test` only: one result per target, for the chain's own marks. */
  results?: { detail: string; target: string; verdict: "bad" | "blocked" | "good" }[];
}

/** Everything an action is given: the portal's own context, the CLI's two, and the workflow. */
export interface ActionContext {
  /** The folder the portal was started in: the project its auto-mode rules come from. */
  cwd: string;
  /** What the portal remembers between pages (`portal.json`). */
  memory: PortalMemory;
  omniroute: OmnirouteContext;
  portal: PortalContext;
  /**
   * The project's own defaults, remembered for this run: reading them runs git and, when `gh`
   * is there, GitHub itself, so one file's answers are computed once (`server.ts`).
   */
  projectDefaults: ProjectDefaultsReader;
  /** The workflow module (`src/workflow/`, `src/project/init.ts`), behind one adapter. */
  workflow: WorkflowAdapter;
}

/** The portal's own small state, in the plugin's state folder. */
export interface PortalMemory {
  /**
   * The opus and fable chains, by slot key (`cc-smart-dev-kit-opus`): what the models switch
   * turns on again. The slot key, never the family name: the switch reads the same key.
   * Named `fallback` in the file since 0.4.x, when those slots were a fallback: kept, so a
   * saved file still reads.
   */
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

/**
 * Sets a slot's fallback switch through `gateway fallback`, the command line's own checks:
 * a slot with no saved chain has none to set.
 */
async function setSlotFallback(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const slot = typeof body.slot === "string" ? slotArg(body.slot) : "";
  if (slot === "" || typeof body.on !== "boolean") {
    return { lines: ["Pick a slot, and say on or off."], ok: false };
  }
  return gateway(action, ["fallback", slot, body.on ? "on" : "off"]);
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
 * The opus and fable slots. Off turns both off (Opus and Fable answer themselves). On puts
 * the remembered chains back (a model slot needs no test: the CLI checks its model list). A
 * family with nothing remembered is named, not invented.
 */
async function switchModels(action: ActionContext, on: boolean): Promise<ActionResult> {
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
      lines: lines.length === 0 ? ["The opus and fable slots were already off."] : lines,
      ok,
    };
  }
  const missing: string[] = [];
  const lines: string[] = [];
  let turnedOn = 0;
  let ok = true;
  for (const slot of slots) {
    const targets = action.memory.fallback[slot] ?? [];
    if (targets.length === 0) {
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
      `No saved chain for ${missing.join(" or ")}: go to Slots, pick it, add a model, and Save.`,
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

// ── The workflow settings ───────────────────────────────────────────────────────

/**
 * One setting the Settings page changed. The key must be a row of that page, the value one
 * of that row's own (`parseSettingValue`), and a project-owned setting needs the page's own
 * confirmation — a hand-made POST can never write what the form itself could not send. The
 * write itself is the module's own (`writePersonalSetting` / `writeProjectSetting`), so the
 * file, its indentation and its validation are the command line's, never a second copy.
 */
async function setWorkflowSetting(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const spec = settingSpec(body.key);
  if (spec === undefined) {
    return { lines: [`"${String(body.key)}" is not a setting this page shows.`], ok: false };
  }
  const parsed = parseSettingValue(spec, body.value);
  if (!parsed.ok) return { lines: [parsed.why], ok: false };
  if (spec.where === "project") {
    if (body.confirm !== true) {
      return {
        lines: ["The project's own setting was not confirmed, so nothing was written."],
        ok: false,
      };
    }
    // The row is read-only without a project file, because there is nothing to write it into;
    // a hand-made POST gets the same answer, not another file's.
    if (readProject(action.portal, action.cwd).configFile === null) {
      return {
        lines: [
          `${spec.key} is this project's own setting, and this project has no .claude/cc-smart-dev-kit.json yet: set it up on Machine first.`,
        ],
        ok: false,
      };
    }
  }
  try {
    // The project's writer runs git with the portal's own environment, never `process.env`:
    // the portal reaches this machine only through its context (`context.ts`).
    const line =
      spec.where === "project"
        ? action.workflow.writeProjectSetting(action.cwd, spec.key, parsed.value, action.portal.env)
        : action.workflow.writePersonalSetting(action.portal.paths, spec.key, parsed.value);
    return { lines: [line], ok: true };
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

// ── The project's two files ─────────────────────────────────────────────────────

/** The form's own fields: everything the Project card shows, and nothing else. */
export interface ProjectFormFields {
  base: string;
  bases: Record<string, string>;
  engine: "plugin" | "own";
  guards: { guardMainFolder: boolean; jobRoute: boolean; sessionNames: boolean };
  prefix: string;
  protectedBranches: string[];
  setup: null | string[];
}

/**
 * The form's answers, checked field by field: a value the command line would refuse is
 * refused here too, in the same words (`"hotfix" is not prefix=base`). Only the fields the
 * form shows are taken; a field it does not show never arrives from a page.
 */
export function parseProjectForm(
  value: unknown,
): { ok: true; value: ProjectFormFields } | { ok: false; why: string } {
  if (!isObject(value)) return { ok: false, why: "The form's answers did not arrive." };
  const base = typeof value.base === "string" ? value.base.trim() : "";
  if (base === "") {
    return {
      ok: false,
      why: "The base branch is needed: it is the branch a new worktree starts from.",
    };
  }
  const prefix = typeof value.prefix === "string" ? value.prefix.trim() : "";
  if (prefix === "") {
    return {
      ok: false,
      why: "The worktree folder prefix is needed: it names the folder beside the repo.",
    };
  }
  if (prefix.includes("/") || prefix.includes("\\")) {
    return {
      ok: false,
      why: "The worktree folder prefix cannot hold / or \\: it is a folder name.",
    };
  }
  let setup: null | string[] = null;
  if (value.setup !== null && value.setup !== undefined) {
    if (
      !Array.isArray(value.setup) ||
      value.setup.length === 0 ||
      !value.setup.every((word) => typeof word === "string" && word !== "")
    ) {
      return { ok: false, why: 'The setup command must be words, like "bun install".' };
    }
    setup = value.setup as string[];
  }
  if (!isObject(value.bases)) return { ok: false, why: "The bases must be prefix → base pairs." };
  const bases: Record<string, string> = {};
  for (const [from, to] of Object.entries(value.bases)) {
    if (!from.endsWith("/") || typeof to !== "string" || to === "") {
      return { ok: false, why: `"${from}" is not prefix=base: the prefix ends with "/".` };
    }
    bases[from] = to;
  }
  if (!Array.isArray(value.protectedBranches)) {
    return { ok: false, why: "The protected branches must be a list of branch names." };
  }
  const protectedBranches: string[] = [];
  for (const name of value.protectedBranches) {
    if (typeof name !== "string" || name === "") {
      return { ok: false, why: "The protected branches must be a list of branch names." };
    }
    protectedBranches.push(name);
  }
  if (!isObject(value.guards))
    return { ok: false, why: "guards must say true or false for each guard." };
  const guards = { guardMainFolder: false, jobRoute: false, sessionNames: false };
  // The order the form shows them in, so a refused one is named the way the page reads.
  for (const name of ["guardMainFolder", "sessionNames", "jobRoute"] as const) {
    const on = value.guards[name];
    if (typeof on !== "boolean") return { ok: false, why: `guards.${name} is true or false.` };
    guards[name] = on;
  }
  if (value.engine !== "plugin" && value.engine !== "own") {
    return { ok: false, why: 'The worktree engine is "plugin" or "own".' };
  }
  return {
    ok: true,
    value: { base, bases, engine: value.engine, guards, prefix, protectedBranches, setup },
  };
}

/**
 * The answers a POST would write: the form's own fields over the project's own defaults
 * (`projectInitDefaults`), so the fields the form does not show — the workflow policy, and
 * anything the command line detects — come from the machine, never from a browser.
 */
function projectAnswers(
  action: ActionContext,
  body: Record<string, unknown>,
):
  | {
      ok: true;
      answers: ProjectInitAnswers;
      existing: null | string;
      existingSettings: null | string;
      root: string;
    }
  | { ok: false; why: string } {
  const project = readProject(action.portal, action.cwd);
  if (project.root === null) {
    return { ok: false, why: project.why ?? "there is no project folder here" };
  }
  const form = parseProjectForm(body.answers);
  if (!form.ok) return form;
  const texts = projectFileTexts(project.root);
  try {
    const defaults = action.projectDefaults({ env: action.portal.env, root: project.root });
    return {
      ok: true,
      answers: { ...defaults.answers, ...form.value },
      ...texts,
      root: project.root,
    };
  } catch (error) {
    return { ok: false, why: messageOf(error) };
  }
}

/** The project's two files, as the form would leave them — the plan, never a write. */
async function projectPreview(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const built = projectAnswers(action, body);
  if (!built.ok) return { lines: [built.why], ok: false };
  try {
    const plan = action.workflow.planProjectInit({
      answers: built.answers,
      existing: built.existing,
      existingSettings: built.existingSettings,
      root: built.root,
    });
    // The line under the settings box travels with the plan: the page draws the same sentence
    // from the same helper, so the two can never describe different plans.
    return {
      filesHash: projectFilesHash({
        existing: built.existing,
        existingSettings: built.existingSettings,
      }),
      lines: [settingsLineNote(plan.hookLines.length, plan.removedLines.length)],
      ok: true,
      preview: plan,
    };
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

/**
 * Writes the project's two files, through `applyProjectInit` — a backup first, an atomic
 * write, and **never a commit**: both files belong to the project, and the person commits
 * them.
 *
 * **The plan is made again, and only while the two files are still the ones the page planned
 * against.** The form holds the whole file it would write — the protected branches, the
 * bases, the guards — so a field filled in from a plan made before someone else edited the
 * project's file would quietly write their change away. The page sends back the hash its
 * preview carried (`projectFilesHash`); a text that differs now is refused, and the person
 * previews again.
 */
async function projectWrite(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) {
    return { lines: ["The write was not confirmed, so nothing was written."], ok: false };
  }
  const built = projectAnswers(action, body);
  if (!built.ok) return { lines: [built.why], ok: false };
  if (body.previewHash !== projectFilesHash(built)) {
    return {
      lines: ["The project's files changed since the preview — preview again."],
      ok: false,
    };
  }
  try {
    const plan = action.workflow.planProjectInit({
      answers: built.answers,
      existing: built.existing,
      existingSettings: built.existingSettings,
      root: built.root,
    });
    const writes = action.workflow.applyProjectInit(plan, {
      stateDir: action.portal.paths.stateDir,
    });
    if (writes.length === 0) {
      return { lines: ["Nothing to change: both files already say this."], ok: true };
    }
    return {
      lines: [
        ...writes.map((write) => `${write.created ? "+" : "~"} ${write.file}`),
        "Commit both files with the project: the team shares one setup.",
      ],
      ok: true,
    };
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

/**
 * The Browser card's setup button: the same steps `cc-smart-dev-kit browser setup` runs, through
 * the same module — Chrome is opened on the extension's Web Store page in the `claude-code`
 * profile, and anything that is left for the person is printed. It never installs or removes an
 * extension, and it never deletes a Chrome profile. What it does write is exactly what that
 * command writes by itself, and every one of them is reported in the answer's lines: the
 * profile's display name in Chrome's own `Local State`, and only while no Chrome runs on that
 * user data folder (through the managed-file helpers, so `restore` puts it back), and, on
 * Windows, the per-user HKCU key that offers the extension in that profile. The person still
 * clicks Enable.
 */
async function browserSetupAction(action: ActionContext): Promise<ActionResult> {
  try {
    const result = browserSetup(
      action.portal.paths,
      realBrowserSetupDeps(action.portal.machine, action.portal.paths.home),
      { apply: true },
    );
    return {
      lines: [
        ...(result.changes.length > 0 ? result.changes : ["Nothing to change."]),
        ...result.info,
        ...result.notes,
        ...result.guide,
      ],
      ok: result.ok,
    };
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

/**
 * The Browser card's token field: the same writer `cc-smart-dev-kit browser token` uses
 * (`writeBrowserToken`), so a token saved here and one saved in a terminal are the same file,
 * and the same protection. The value is checked first (the extension's own shape), and **never
 * printed back**: the answer says the token is set, and nothing of it reaches the page, a line
 * or a log.
 */
function browserTokenAction(action: ActionContext, body: Record<string, unknown>): ActionResult {
  const pasted = typeof body.token === "string" ? body.token : "";
  const parsed = parseBrowserToken(pasted);
  if (!parsed.ok) {
    // An empty field with a token already saved is not a failure: nothing was lost, and there
    // is nothing to fix. "The token was not saved" would read as though it had gone, so the
    // page is told the fact, in its own quieter tone. With no token saved it stays a refusal:
    // the browser does not work until one is pasted.
    if (pasted.trim() === "" && readBrowserToken(action.portal.paths).source === "file") {
      return {
        lines: ["Nothing was pasted, so the saved token is unchanged."],
        ok: false,
        tone: "info",
      };
    }
    return { lines: [`The token was not saved: ${parsed.why}.`], ok: false };
  }
  try {
    writeBrowserToken(action.portal.paths, parsed.token);
    return {
      lines: [
        // The command line's own line, word for word (`src/entries/cli.ts`): the portal
        // shows what `browser token` prints, never a second wording of it.
        tokenSavedLine(action.portal.paths.browserTokenFile),
        "Start a new Claude session (or restart the running one) to use it.",
      ],
      ok: true,
    };
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
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
    case "slot.fallback":
      return setSlotFallback(action, body);
    case "switch": {
      const which = typeof body.name === "string" ? body.name : "";
      const on = body.on === true;
      switch (which) {
        case "gateway":
          return switchGateway(action, on);
        case "judge":
          return switchJudge(action, on);
        case "models":
          return switchModels(action, on);
        case "hold":
          return switchHold(action, on);
        default:
          return { lines: [`"${which}" is not a switch.`], ok: false };
      }
    }
    case "browser.setup":
      return browserSetupAction(action);
    case "browser.token":
      return browserTokenAction(action, body);
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
    case "workflow.set":
      return setWorkflowSetting(action, body);
    case "project.preview":
      return projectPreview(action, body);
    case "project.write":
      return projectWrite(action, body);
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
