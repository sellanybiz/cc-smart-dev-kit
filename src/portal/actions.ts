import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { browserSetup, realBrowserSetupDeps } from "../browser/setup";
import {
  parseBrowserToken,
  readBrowserToken,
  tokenSavedLine,
  writeBrowserToken,
} from "../browser/token";
import { COMMAND } from "../build-info";
import { type Check, checkLine, type DoctorOptions, doctorChecks } from "../cli/doctor";
import { tildify } from "../cli/paths";
import { runUpdate } from "../cli/update";
import { listModels, probeModel } from "../gateway/backends";
import {
  chainProblem,
  type GatewayContext,
  runGateway,
  setOmnirouteKey,
} from "../gateway/commands";
import { notSlotName } from "../gateway/commands-chains";
import {
  effortPin,
  type GatewayConfig,
  keptChain,
  loadConfigFile,
  messageOf,
  PROFILE_NAME_RULE,
  slotMode,
} from "../gateway/config";
import { testJudgeTarget } from "../gateway/judge-test";
import {
  BACKEND_EFFORT_LEVELS,
  isProfileName,
  JUDGE_SLOT,
  MODEL_SLOTS,
  parseTarget,
  slotKeyFromArg,
} from "../gateway/targets";
import { realMemoryFacts } from "../jobs/memory";
import { type JobContext, readJobs, statusLines } from "../jobs/status";
import { CLAUDE_PROVIDER, FALLBACK_OFF } from "../machine/claude-mem";
import {
  type ChoiceResult,
  chooseFallback,
  chooseKey,
  chooseRoute,
  type FallbackChoice,
  followSetup,
  type KeyChoice,
  takeOver,
} from "../machine/claude-mem-choices";
import { companions } from "../machine/companions";
import { type OmnirouteContext, runOmniroute } from "../omniroute/commands";
import { locateCheckoutAsync } from "../project/resolve";
import { readFinishedSessions } from "../sessions/finished";
import { type AutoModeSource, applyAutoMode, autoModeSource } from "../setup/auto-mode";
import { findUserInstall } from "../setup/installed-plugins";
import { withLock } from "../setup/lock";
import type { ManagedEntriesResult } from "../setup/managed-entries";
import { isObject } from "../setup/managed-json";
import { CLAUDE_TIMEOUT_MS, commandContext } from "../update/apply";
import { checkoutFold } from "../update/retired-repos";
import {
  heldSince,
  type LastCheck,
  readHeldMajor,
  readLastCheck,
  updateFiles,
} from "../update/state";
import { PROPOSE_WORST_CASE_MS, proposeTimeoutLine } from "../workflow/propose";
import { WORKFLOW_KEYS, type WorkflowKey } from "../workflow/schema";
import { readPortalAgents } from "./api/agents-read";
import { forgetPageReads } from "./api/page-reads";
import {
  addProjectRoot,
  forgetProjectsList,
  type ProjectsWorld,
  projectRootById,
} from "./api/projects";
import type { LivePublish } from "./api/types";
import { runCliChild } from "./cli-child";
import { healthFetch, type PortalContext } from "./context";
import {
  type ProjectDefaultsReader,
  projectFilesHash,
  projectFileTexts,
  readProject,
  settingsLineNote,
  shownDetail,
  slotStamp,
} from "./facts";
import { parseSettingValue, settingSpec } from "./settings";
import type { ProjectInitAnswers, ProjectInitPlan, WorkflowAdapter } from "./workflow-adapter";
import { forgetWorktrees } from "./worktrees-read";

/**
 * The OmniRoute context every portal action uses: the portal's own network, clock and runner,
 * and no terminal question (`confirm: null` — the page asks instead, and passes `--yes`). The
 * wait after a restart is the probe's own sleep, so a test drives it like the rest of the
 * clock. One home, so a test can build the same context the server builds.
 */
export function portalOmnirouteContext(ctx: PortalContext): OmnirouteContext {
  // The portal usually starts from a SessionStart hook, so its environment holds `CLAUDECODE=1`;
  // an OmniRoute update refuses inside a Claude Code session, and a click is the person's, not
  // a session's. The CLI children drop it the same way (`cliChildEnv`).
  const env = { ...ctx.env };
  delete env.CLAUDECODE;
  return {
    confirm: null,
    env,
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
   * "nothing was pasted, so the saved token is unchanged" is the one case. `"warn"`: done, with a
   * warning the page must show as one — a gateway key saved without OmniRoute accepting it
   * (PK1). Left out, a refusal is an alarm, as every other one is.
   */
  tone?: "info" | "warn";
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
  /**
   * `project.workflow.propose` only: the pull request it opened, for the card's own link. Read
   * from the command's `--json` line, and only from a run that exited 0.
   */
  url?: string;
}

/** Everything an action is given: the portal's own context, the CLI's two, and the workflow. */
export interface ActionContext {
  /** The folder the portal was started in: the project its auto-mode rules come from. */
  cwd: string;
  omniroute: OmnirouteContext;
  portal: PortalContext;
  /**
   * The live stream's publisher, when the server has one: a long action's progress and its
   * result go out to every open page while it runs (B6b). Absent in a test that only calls
   * the actions.
   */
  publish?: LivePublish;
  /**
   * The project's own defaults, remembered for this run: reading them runs git and, when `gh`
   * is there, GitHub itself, so one file's answers are computed once (`server.ts`).
   */
  projectDefaults: ProjectDefaultsReader;
  /** The workflow module (`src/workflow/`, `src/project/init.ts`), behind one adapter. */
  workflow: WorkflowAdapter;
}

/** Every line a command printed, collected. A failure's line is kept too: the page shows it. */
function collector(onLine?: (line: string) => void): {
  lines: string[];
  print: (line: string) => void;
  error: (line: string) => void;
} {
  const lines: string[] = [];
  const push = (line: string): void => {
    for (const one of line.split("\n")) {
      if (one.trim() === "") continue;
      lines.push(one);
      onLine?.(one);
    }
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
    // A backend's own words can hold the key it was sent: every detail below is masked first.
    const keys = [backend.apiKey];
    const listed = await listModels(backend.baseUrl, backend.apiKey, 8_000);
    if ("error" in listed || listed.status !== 200) {
      const why = "error" in listed ? shownDetail(listed.error, keys) : `HTTP ${listed.status}`;
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
      const result = await testJudgeTarget(
        backend.baseUrl,
        backend.apiKey,
        parsed.target.model,
        undefined,
        effortPin(config, slot, text),
      );
      const detail = shownDetail(result.detail, keys);
      results.push({
        detail,
        target: text,
        verdict: result.verdict === "block" ? "blocked" : "bad",
      });
      lines.push(
        result.verdict === "block"
          ? `${text}: blocked the force-push test`
          : `${text}: ✗ it did not block the force-push test (${detail})`,
      );
      continue;
    }
    const probe = await probeModel({
      apiKey: backend.apiKey,
      baseUrl: backend.baseUrl,
      fetchImpl: action.portal.fetch,
      model: parsed.target.model,
    });
    const detail = shownDetail(probe.detail, keys);
    results.push({ detail, target: text, verdict: probe.ok ? "good" : "bad" });
    lines.push(`${text}: ${probe.ok ? "✓" : "✗"} ${detail}`);
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

/** Sets a slot's breaker switch through `gateway breaker`: the judge has none (it never holds). */
async function setSlotBreaker(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const slot = typeof body.slot === "string" ? slotArg(body.slot) : "";
  if (slot === "" || typeof body.on !== "boolean") {
    return { lines: ["Pick a slot, and say on or off."], ok: false };
  }
  return gateway(action, ["breaker", slot, body.on ? "on" : "off"]);
}

/**
 * Pins one backend target's effort through `gateway effort`, or takes the pin off with `off`.
 * The command refuses a `claude-…` target and a target outside the chain in use, and sends one
 * test request at the level first: a refusal is this action's answer, in its words, and nothing
 * is saved.
 */
async function setSlotEffort(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const slot = typeof body.slot === "string" ? slotArg(body.slot) : "";
  const target = typeof body.target === "string" ? body.target : "";
  const level = typeof body.level === "string" ? body.level : "";
  if (
    slot === "" ||
    target === "" ||
    (level !== "off" && !BACKEND_EFFORT_LEVELS.some((one) => one === level))
  ) {
    return { lines: ["Pick a slot, one of its backend targets, and a level or off."], ok: false };
  }
  try {
    return await gateway(action, ["effort", slot, target, level]);
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

/**
 * Saves a chain through `gateway slot`, which also puts it in use. The config is the one home
 * of every chain: in use in `slots`, saved in `kept` while the slot answers as Claude. The
 * portal keeps none of its own.
 *
 * `stamp` is the chain as the page read it (`slotStamp`): a page open since before another
 * tab or the command line changed this slot's chain would otherwise overwrite that change
 * unseen, so such a save is refused and the page offers the newer chain. Any value that is
 * not this chain's stamp (a number, a stale string) is refused the same way.
 */
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
  // The stamp guards a page against its own old copy, not a caller against the portal (D9 has
  // no sign-in): the server-rendered page sends none, and is checked by `gateway slot` alone.
  if (body.stamp !== undefined && slotStamp(gatewayConfig(action), slot) !== body.stamp) {
    return {
      lines: [
        "This slot's chain changed since the page read it (another tab, or the command line), so nothing was saved.",
        "Load the newer chain, then make the change again.",
      ],
      ok: false,
    };
  }
  return gateway(action, ["slot", slot, targets.join(",")]);
}

/**
 * What is wrong with one target, the way `gateway slot` checks it (`chainProblem`: it parses,
 * its backend is in the config, and that backend lists the model), in words; null when it is
 * fine. A `claude-…` id is taken as it is, as the command line takes it. The slot picker's
 * check and claude-mem's card use this one check, so neither takes a model typed free.
 */
async function targetProblem(action: ActionContext, text: string): Promise<null | string> {
  const config = gatewayConfig(action);
  const parsed = parseTarget(text);
  const models: Record<string, null | string[]> = {};
  if ("target" in parsed && parsed.target.kind !== "anthropic") {
    const backend = config.backends[parsed.target.backend];
    if (backend !== undefined) {
      const listed = await listModels(backend.baseUrl, backend.apiKey, 8_000);
      models[parsed.target.backend] =
        "error" in listed || listed.status !== 200 ? null : listed.models.map((model) => model.id);
    }
  }
  const problem = chainProblem(config, [text], models);
  if (problem === null) return null;
  const names = Object.keys(config.backends);
  const known =
    "target" in parsed &&
    parsed.target.kind !== "anthropic" &&
    !Object.hasOwn(config.backends, parsed.target.backend)
      ? `. The config names: ${names.length === 0 ? "no backend" : names.join(", ")}.`
      : "";
  // A backend's model list never holds its key, but the line is masked all the same.
  return `${shownDetail(problem, [])}${known}`;
}

/**
 * Checks one typed target before the page adds it to a draft (`targetProblem`).
 */
async function checkTarget(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const text = typeof body.target === "string" ? body.target.trim() : "";
  if (text === "")
    return { lines: ["Type a target: claude-<id> or <backend>:<model>."], ok: false };
  const parsed = parseTarget(text);
  const problem = await targetProblem(action, text);
  if (problem !== null) return { lines: [problem], ok: false };
  return {
    lines: [
      "target" in parsed && parsed.target.kind === "anthropic"
        ? `${text}: on your own Claude login.`
        : `${text}: its backend lists it.`,
    ],
    ok: true,
  };
}

/**
 * A slot's mode, the same switch for every slot: `gateway slot <slot> claude` (the chain is
 * saved, not in use) or `gateway slot <slot> custom` (the saved chain in use again; a judge
 * target without a current test proof is tested first). The command line's own checks and
 * refusals, in its own words.
 */
async function setSlotMode(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const slot = typeof body.slot === "string" ? slotArg(body.slot) : "";
  if (slot === "" || (body.mode !== "claude" && body.mode !== "custom")) {
    return { lines: ['Pick a slot, and say "claude" or "custom".'], ok: false };
  }
  return gateway(action, ["slot", slot, body.mode]);
}

/** The config as the command line reads it, for a switch that asks what each slot is now. */
function gatewayConfig(action: ActionContext): GatewayConfig {
  return loadConfigFile(action.portal.paths.gatewayConfigFile);
}

// ── Switches ────────────────────────────────────────────────────────────────────

async function switchGateway(action: ActionContext, on: boolean): Promise<ActionResult> {
  return gateway(action, [on ? "on" : "off"]);
}

/**
 * The Overview's judge switch: the judge slot's mode (`setSlotMode`). On uses the saved judge
 * chain; with none saved, the page is told how to make one.
 */
async function switchJudge(action: ActionContext, on: boolean): Promise<ActionResult> {
  const config = gatewayConfig(action);
  const mode = on ? "custom" : "claude";
  // Already there: say so, and run nothing (a second click must not be an error).
  if (slotMode(config, JUDGE_SLOT) === mode) {
    return {
      lines: [`The judge is already ${on ? "Custom" : "Claude"}.`],
      ok: true,
    };
  }
  if (on && keptChain(config, JUDGE_SLOT) === null) {
    return {
      lines: [
        "No judge chain is saved, so the switch cannot turn one on.",
        "Go to Slots, pick judge, add a model, run the force-push test, and Save.",
      ],
      ok: false,
    };
  }
  return gateway(action, ["slot", "judge", mode]);
}

/**
 * The Overview's one switch for the opus and fable slots, until the Slots page gives each its
 * own: each slot's mode in turn (`setSlotMode`), one at a time (each takes setup's lock). A
 * slot already in that mode is left as it is; one with nothing saved is named, not invented.
 */
async function switchModelSlots(action: ActionContext, on: boolean): Promise<ActionResult> {
  const config = gatewayConfig(action);
  const mode = on ? "custom" : "claude";
  const missing: string[] = [];
  const lines: string[] = [];
  let changed = 0;
  let ok = true;
  for (const slot of Object.keys(MODEL_SLOTS)) {
    if (slotMode(config, slot) === mode) continue;
    if (on && keptChain(config, slot) === null) {
      missing.push(slot.replace(/^cc-smart-dev-kit-/, ""));
      continue;
    }
    // A refusal is an error thrown by the command; it is this slot's answer, and the next
    // slot is still switched.
    let result: ActionResult;
    try {
      result = await gateway(action, ["slot", slot, mode]);
    } catch (error) {
      result = { lines: [messageOf(error)], ok: false };
    }
    ok = ok && result.ok;
    lines.push(...result.lines);
    if (result.ok) changed += 1;
  }
  if (missing.length > 0) {
    lines.push(
      `No saved chain for ${missing.join(" or ")}: go to Slots, pick it, add a model, and Save.`,
    );
  }
  if (changed === 0 && on) {
    // Nothing was turned on, so the switch must not read as a success: the page shows these
    // lines in its failure colour, and the switch's own state stays off.
    lines.push("Nothing was turned on, so the switch is still off.");
    return { lines, ok: false };
  }
  if (changed === 0 && lines.length === 0) {
    return { lines: ["The opus and fable slots were already off."], ok: true };
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
 *
 * **It spawns asynchronously (B6b).** `Bun.spawnSync` here blocked the whole server — every
 * page, every action and the live stream — for as long as `claude plugin` took (up to 300 s),
 * which is the owner's "lag" bug. Each step's last line also goes out on the live stream, so
 * the page shows the install as it happens.
 */
function stepRunner(action: ActionContext, lines: string[], name: string) {
  const context = commandContext(action.portal.env, action.portal.paths.home);
  const publish = (line: string): void => {
    action.publish?.("action", { action: name, line });
  };
  return async (argv: string[]): Promise<{ exitCode: number; output: string }> => {
    try {
      const child = Bun.spawn(argv, {
        ...context,
        stdin: "ignore",
        stderr: "pipe",
        stdout: "pipe",
        timeout: CLAUDE_TIMEOUT_MS,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        readStream(child.stdout),
        readStream(child.stderr),
        child.exited,
      ]);
      const output = `${stdout}${stderr}`.trim();
      const last = output.split("\n").at(-1) ?? "";
      if (last !== "") {
        lines.push(`  ${last}`);
        publish(`  ${last}`);
      }
      return { exitCode, output };
    } catch (error) {
      return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** A child's piped output as text; an empty string when it was not piped. */
async function readStream(
  stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
  if (stream === undefined || typeof stream === "number") return "";
  return await new Response(stream).text();
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
  const sinks = collector((line) => action.publish?.("action", { action: "update.install", line }));
  const code = await runUpdate(action.portal.paths, action.portal.env, [], action.portal.now, {
    ...sinks,
    run: stepRunner(action, sinks.lines, "update.install"),
  });
  return { lines: sinks.lines, ok: code === 0 };
}

/**
 * What one doctor pass runs: the options, built for the plugin's folder **as it is now**, or
 * why it cannot run (the folder is gone — an update during a long run). Building them per pass
 * is the point: the portal runs from a copy, and a path made at startup points at the version
 * folder the update deleted.
 */
export type DoctorSource =
  | (() => DoctorOptions | { error: string })
  | (() => Promise<DoctorOptions | { error: string }>);

/** Runs the doctor pass, and hands the checks back so the page can store and show them. */
export async function runDoctorPass(
  action: ActionContext,
  source: DoctorSource,
): Promise<{ checks: Check[]; lines: string[]; ok: boolean }> {
  const options = await source();
  if ("error" in options) {
    // One failed check, in the page's own shape: what happened, and what to do about it.
    const failed: Check = {
      ok: false,
      text: options.error,
      fix: `run it in a terminal: ${COMMAND} doctor`,
    };
    return { checks: [failed], lines: [checkLine(failed)], ok: false };
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

/** The auto-mode change a page shows: the command line's `+` / `-` lines, and their hash. */
export interface AutoModeChange {
  /** Rules that go into the user's settings (`+`). */
  added: string[];
  /** In a worktree with its own file: the main checkout's, when its rules differ. */
  differsFrom: null | string;
  /** The project file the rules come from. */
  from: string;
  /** `autoModeHash` of everything above and the rules wanted: what the write sends back. */
  hash: string;
  /** Rules this project put there before and no longer asks for (`-`). */
  removed: string[];
  /** Claude Code's user settings, where they go. */
  settings: string;
  wanted: AutoModeSource;
}

/**
 * The project's auto-mode rules for the folder the portal runs in, and the change writing
 * them makes — the same dry run `cc-smart-dev-kit setup` shows as `+` / `-` lines. Null outside a
 * git project. Throws what `autoModeSource` throws (a broken or too-new project file).
 */
export function autoModeChange(action: ActionContext): AutoModeChange | null {
  const { paths, which } = action.portal;
  const wanted = autoModeSource(action.cwd, which);
  if (wanted === null) return null;
  const diff = applyAutoMode(paths.settingsFile, paths.stateDir, wanted, true);
  const from = wanted.file ?? wanted.source;
  const shown = {
    added: diff.added,
    differsFrom: wanted.differsFrom,
    entries: wanted.entries,
    from,
    removed: diff.removed,
    source: wanted.source,
  };
  return {
    added: diff.added,
    differsFrom: wanted.differsFrom,
    from,
    hash: createHash("sha256").update(JSON.stringify(shown)).digest("hex").slice(0, 32),
    removed: diff.removed,
    settings: paths.settingsFile,
    wanted,
  };
}

/**
 * Writes the project's auto-mode trust rules into Claude Code's user settings. The page's
 * own confirmation stands in for the terminal question the CLI asks; without it, nothing is
 * written. The whole thing runs under setup's lock, like every other managed write.
 *
 * **Only what the page showed.** The change is planned again under the lock, and written only
 * when its hash is the one the page drew (`autoModeChange`): a rule added to the project's
 * file after the page was drawn — by a session, in the folder the portal runs in — would be
 * trusted without anyone having read it. A hand-made POST without the hash writes nothing.
 */
async function applyAutoModeAction(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) {
    return { lines: ["The rules were not confirmed, so nothing was written."], ok: false };
  }
  const { portal } = action;
  try {
    return await withLock(
      portal.paths.stateDir,
      (): ActionResult => {
        const change = autoModeChange(action);
        if (change === null) {
          return {
            lines: ["This folder is not inside a git project, so there is nothing to copy."],
            ok: false,
          };
        }
        if (body.shownHash !== change.hash) {
          return {
            lines: [
              "The trust rules changed since this page showed them, so nothing was written. Read them again on the page, then write them.",
            ],
            ok: false,
          };
        }
        const result = applyAutoMode(
          portal.paths.settingsFile,
          portal.paths.stateDir,
          change.wanted,
          false,
        );
        return {
          lines: [
            ...entryLines(result),
            "Auto mode reads these from your user settings, the only place it trusts.",
          ],
          ok: true,
        };
      },
      { waitMs: 10_000 },
    );
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
    if ((await readProject(action.portal, action.cwd)).configFile === null) {
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

async function projectWorkflowPropose(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) return notConfirmed("proposed");
  const unnamed = projectNotNamed(body, "a proposal never runs in the portal's own folder");
  if (unnamed !== null) return unnamed;
  const target = await projectTarget(action, body);
  if ("why" in target) return { lines: [target.why], ok: false };
  const setting = typeof body.setting === "string" ? body.setting.trim() : "";
  if (!WORKFLOW_KEYS.includes(setting as WorkflowKey)) {
    return {
      lines: [`"${setting}" is not a setting: the settings are ${WORKFLOW_KEYS.join(", ")}.`],
      ok: false,
    };
  }
  const unset = body.unset === true;
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!unset && value === "") {
    return { lines: ["Type the setting's value, or remove it from the project."], ok: false };
  }
  // A value never starts with "-"; letting one through would read as the command's own option.
  if (!unset && value.startsWith("-")) {
    return { lines: [`"${value}" is not a value: it starts with "-".`], ok: false };
  }
  // `--json`: on success the command prints one line `{ url, branch, worktree, … }` — a contract
  // that does not move with its human words — and on any refusal it prints none, so a URL can
  // never come out of a failure. The child gets the command's own worst case and more
  // (`PROPOSE_WORST_CASE_MS`): its limits fire, and its take-back runs, before it is ended.
  const run = await runCliChild(
    action.portal,
    ["workflow", "propose", setting, ...(unset ? ["--unset"] : [value]), "--json"],
    {
      cwd: target.cwd,
      onLine: (line) => action.publish?.("action", { action: "project.workflow.propose", line }),
      timeoutMs: PROPOSE_WORST_CASE_MS,
    },
  );
  const lines = [...run.lines];
  if (run.error !== null) lines.push(run.error);
  if (run.timedOut) lines.push(proposeTimeoutLine(setting));
  const ok = run.error === null && !run.timedOut && run.exitCode === 0;
  const opened = ok ? proposedLine(run.lines) : null;
  if (opened === null) return { lines, ok };
  return {
    lines: [`Opened ${opened.url}`, `Branch ${opened.branch}, in ${opened.worktree}.`],
    ok,
    url: opened.url,
  };
}

// ── A project's gateway (GP4b) ─────────────────────────────────────────────────

/** The three states `gateway project` writes. */
const PROJECT_GATEWAY_STATES = ["on", "off", "default"] as const;

/**
 * The CLI's own `gateway …` command for one click of the Gateway card, in a child: the
 * command's checks, its lock, its words and its refusals, never a copy of them. `cwd` is the
 * project's own folder (a state) or the portal's (a profile: it is the machine's config).
 */
async function gatewayCliAction(
  action: ActionContext,
  name: string,
  args: string[],
  cwd: null | string,
): Promise<ActionResult> {
  const run = await runCliChild(action.portal, ["gateway", ...args], {
    cwd,
    onLine: (line) => action.publish?.("action", { action: name, line }),
  });
  const lines = [...run.lines];
  if (run.error !== null) lines.push(run.error);
  if (run.timedOut)
    lines.push(`gateway ${args[0] ?? ""} did not answer in time: nothing more is known.`);
  return { lines, ok: run.error === null && !run.timedOut && run.exitCode === 0 };
}

/**
 * `project.gateway.set` (GP4b): a project's own gateway state — on (this machine's router, or a
 * profile's `…/p/<name>`), off (Anthropic's own address: the person's own login) or default (no
 * key: the machine decides) — in its personal file, or with `team` its team file (off and
 * default only: a team file never points teammates at one person's router). The page asks
 * first (`confirm`); the CLI's own `gateway project <state> --folder <root>` runs in a child in
 * the project's folder (it runs git, and `on` asks the router first), so its refusals — a file
 * git tracks, a login key, another gateway's address — are the command's own, in place.
 *
 * The project is named by its id and looked up in the server's own list: never a path from the
 * request, and never the portal's own folder by accident.
 */
async function projectGatewaySet(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) return notConfirmed("changed");
  const unnamed = projectNotNamed(
    body,
    "a gateway state is never written to the portal's own folder",
  );
  if (unnamed !== null) return unnamed;
  const target = await projectTarget(action, body);
  if ("why" in target) return { lines: [target.why], ok: false };
  const state = PROJECT_GATEWAY_STATES.find((one) => one === body.state);
  if (state === undefined) {
    return {
      lines: [`"${String(body.state)}" is not a state: say on, off or default.`],
      ok: false,
    };
  }
  if (typeof body.team !== "boolean") return { lines: ["team is true or false."], ok: false };
  if (state === "on" && body.team) {
    return {
      lines: [
        "The team file takes off or default only: it never points teammates at your own router.",
      ],
      ok: false,
    };
  }
  const profile = body.profile ?? null;
  if (profile !== null) {
    if (typeof profile !== "string" || !isProfileName(profile)) {
      return { lines: [`"${String(profile)}": ${PROFILE_NAME_RULE}.`], ok: false };
    }
    if (state !== "on") return { lines: ["A profile goes with on only."], ok: false };
  }
  return gatewayCliAction(
    action,
    "project.gateway.set",
    [
      "project",
      state,
      ...(body.team ? ["--team"] : []),
      ...(profile === null ? [] : ["--profile", profile]),
      "--folder",
      target.cwd,
    ],
    target.cwd,
  );
}

/**
 * `project.gateway.profile` (GP4b): one change to a profile the Gateway card shows — a slot's own
 * chain (`targets`), plain Claude there (`value: "claude"`), the machine's chain again
 * (`value: "machine"`), or the slot's fallback switch (`kind: "fallback"`). A profile is the
 * machine's (`gateway.json`): every project whose address names it gets the change, and the
 * page's question says so. The CLI's own `gateway profile <name> slot|fallback …` runs in a
 * child: it checks each target against its backend's live model list, and the whole config,
 * under its lock.
 */
async function projectGatewayProfile(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) return notConfirmed("changed");
  const profile = typeof body.profile === "string" ? body.profile : "";
  if (!isProfileName(profile)) {
    return { lines: [`"${String(body.profile)}": ${PROFILE_NAME_RULE}.`], ok: false };
  }
  // The command's own slot rule: the five, and a machine's own `cc-smart-dev-kit-<name>`. A
  // name that passes it is a key's own characters, never an option.
  const slot = typeof body.slot === "string" ? body.slot : "";
  if (slotKeyFromArg(slot) === null) {
    return { lines: [`${notSlotName(String(body.slot))}.`], ok: false };
  }
  if (body.kind === "fallback") {
    if (typeof body.on !== "boolean") return { lines: ["on is true or false."], ok: false };
    return gatewayCliAction(
      action,
      "project.gateway.profile",
      ["profile", profile, "fallback", slot, body.on ? "on" : "off"],
      null,
    );
  }
  if (body.kind !== "slot") {
    return {
      lines: [`"${String(body.kind)}" is not a change the card makes: slot or fallback.`],
      ok: false,
    };
  }
  let chain: string;
  if (body.value === "claude") chain = "off";
  else if (body.value === "machine") chain = "clear";
  else {
    const targets = Array.isArray(body.targets) ? body.targets : [];
    if (targets.length === 0) {
      return {
        lines: ["Give the chain at least one target, or choose Claude or the machine's chain."],
        ok: false,
      };
    }
    for (const one of targets) {
      // Each one a target by the command's own parser (`parseTarget`: never a word such as
      // `off` or `clear`, which the command would read as a change of its own), with no comma —
      // the comma joins the chain — and no leading "-", which would read as an option. The
      // command checks the rest against the live model list.
      if (
        typeof one !== "string" ||
        one.includes(",") ||
        one.trim().startsWith("-") ||
        "error" in parseTarget(one)
      ) {
        return {
          lines: [
            `"${String(one)}" is not a target: a target is <backend>:<model>, from the model list.`,
          ],
          ok: false,
        };
      }
    }
    chain = targets.join(",");
  }
  return gatewayCliAction(
    action,
    "project.gateway.profile",
    ["profile", profile, "slot", slot, chain],
    null,
  );
}

/**
 * The pull request a successful `workflow propose --json` printed: its one JSON line, read as
 * the command's contract (`url`, `branch`, `worktree`). Null for any other output — "already
 * set" and "was not set" are plain lines, and a refusal prints no JSON.
 */
function proposedLine(lines: string[]): { branch: string; url: string; worktree: string } | null {
  for (const line of [...lines].reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      isObject(parsed) &&
      typeof parsed.url === "string" &&
      typeof parsed.branch === "string" &&
      typeof parsed.worktree === "string"
    ) {
      return { branch: parsed.branch, url: parsed.url, worktree: parsed.worktree };
    }
  }
  return null;
}

// ── The project's two files ─────────────────────────────────────────────────────

/** The form's own fields: everything the Project card shows, and nothing else. */
export interface ProjectFormFields {
  base: string;
  bases: Record<string, string>;
  guards: { guardMainFolder: boolean; jobRoute: boolean; sessionNames: boolean };
  protectedBranches: string[];
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
  return {
    ok: true,
    value: { base, bases, guards, protectedBranches },
  };
}

/** The Projects page's own world: the portal's folder, paths, environment and clock. */
function projectsWorld(action: ActionContext): ProjectsWorld {
  return {
    cwd: action.cwd,
    env: action.portal.env,
    now: action.portal.now,
    paths: action.portal.paths,
  };
}

/**
 * The refusal for an action that writes or pushes: it must name its project by id, because
 * `projectTarget` answers the portal's own folder (the home folder) for a body with none.
 * Null when the body names one.
 */
function projectNotNamed(body: Record<string, unknown>, why: string): ActionResult | null {
  if (typeof body.project === "string" && body.project.trim() !== "") return null;
  return { lines: [`Name the project by its id: ${why}.`], ok: false };
}

/**
 * The folder a `project.*` action works in. The page may name a project by its id — the one
 * `/api/projects` listed — and the server looks that id up in its own list: a path from a
 * request is never used. No id: the folder the portal runs in, as before.
 */
async function projectTarget(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<{ cwd: string } | { why: string }> {
  const named = body.project;
  // A `project` that is there but is not a string is a request this action cannot read: it
  // names no project, and it must never fall back to the portal's own folder by accident.
  if (named !== undefined && typeof named !== "string") {
    return {
      why: "The project must be named by its id, as a string; nothing was read or written.",
    };
  }
  const id = named === undefined ? "" : named.trim();
  if (id === "") return { cwd: action.cwd };
  const root = await projectRootById(projectsWorld(action), id);
  return root === null
    ? { why: `No project of the list has the id "${id}", so nothing was read or written.` }
    : { cwd: root };
}

/**
 * The answers a POST would write: the form's own fields over the project's own defaults
 * (`projectInitDefaults`), so the fields the form does not show — the workflow policy, and
 * anything the command line detects — come from the machine, never from a browser.
 */
async function projectAnswers(
  action: ActionContext,
  body: Record<string, unknown>,
  cwd: string,
): Promise<
  | {
      ok: true;
      answers: ProjectInitAnswers;
      /** The repo's default branch, which the plan compares the base with. */
      defaultBranch: string;
      existing: null | string;
      existingLocalSettings: null | string;
      existingSettings: null | string;
      root: string;
    }
  | { ok: false; why: string }
> {
  const project = await readProject(action.portal, cwd);
  if (project.root === null) {
    return { ok: false, why: project.why ?? "there is no project folder here" };
  }
  const form = parseProjectForm(body.answers);
  if (!form.ok) return form;
  const texts = projectFileTexts(project.root);
  try {
    const defaults = await action.projectDefaults({ env: action.portal.env, root: project.root });
    return {
      ok: true,
      answers: { ...defaults.answers, ...form.value },
      defaultBranch: defaults.defaultBranch,
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
  const target = await projectTarget(action, body);
  if ("why" in target) return { lines: [target.why], ok: false };
  const built = await projectAnswers(action, body, target.cwd);
  if (!built.ok) return { lines: [built.why], ok: false };
  try {
    const plan = action.workflow.planProjectInit({
      answers: built.answers,
      defaultBranch: built.defaultBranch,
      existing: built.existing,
      existingLocalSettings: built.existingLocalSettings,
      existingSettings: built.existingSettings,
      root: built.root,
    });
    // The line under the settings box travels with the plan: the page draws the same sentence
    // from the same helper, so the two can never describe different plans.
    return {
      filesHash: projectFilesHash(built),
      lines: [settingsLineNote(plan.settings)],
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
 * **The plan is made again, and only while the files are still the ones the page planned
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
  const target = await projectTarget(action, body);
  if ("why" in target) return { lines: [target.why], ok: false };
  const built = await projectAnswers(action, body, target.cwd);
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
      defaultBranch: built.defaultBranch,
      existing: built.existing,
      existingLocalSettings: built.existingLocalSettings,
      existingSettings: built.existingSettings,
      root: built.root,
    });
    const writes = action.workflow.applyProjectInit(plan, {
      stateDir: action.portal.paths.stateDir,
    });
    if (writes.length === 0) {
      return { lines: ["Nothing to change: both files already say this."], ok: true };
    }
    // A row of the list holds the project's two files: the page's next look must read them
    // again, not the list kept before this write.
    forgetProjectsList();
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
 * `project.add`: adds a folder to the Projects page's list. The folder must be absolute, must
 * exist, and must be inside a git checkout; its main checkout root is what goes into the list,
 * so a worktree path adds the repository it belongs to. Anything else is refused in words and
 * nothing is written. The list file is the kit's own state (`portalProjectsFile`), written
 * atomically under the state folder's lock (`addProjectRoot`); the person's files are not
 * touched, and no git child blocks the server (`locateCheckoutAsync`).
 */
async function projectAdd(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const folder = typeof body.folder === "string" ? body.folder.trim() : "";
  if (folder === "") {
    return { lines: ["Type the folder to add, with its full path."], ok: false };
  }
  if (!isAbsolute(folder)) {
    return {
      lines: [`"${folder}" is not an absolute path: give the folder's full path.`],
      ok: false,
    };
  }
  let isFolder = false;
  try {
    isFolder = existsSync(folder) && statSync(folder).isDirectory();
  } catch {
    isFolder = false;
  }
  if (!isFolder) {
    return {
      lines: [`${folder} is not a folder on this machine, so nothing was added.`],
      ok: false,
    };
  }
  let root: null | string;
  try {
    root =
      checkoutFold(await locateCheckoutAsync(folder, { env: action.portal.env }))?.main ?? null;
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
  if (root === null) {
    return {
      lines: [`${folder} is not inside a git checkout, so there is no project to add.`],
      ok: false,
    };
  }
  try {
    const result = await addProjectRoot(action.portal.paths, root);
    return result.added
      ? { lines: [`Added ${root} to the projects list.`], ok: true }
      : { lines: [`${root} is already in the projects list.`], ok: true };
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

// ── claude-mem (PM1) ────────────────────────────────────────────────────────────

/**
 * A claude-mem target from the page, checked the way the slot picker checks one
 * (`targetProblem`): a `<backend>:<model>` its backend lists, or a `claude-…` id when `claude`
 * is allowed. Never a model typed free.
 */
async function claudeMemTarget(
  action: ActionContext,
  text: string,
): Promise<{ backend: string; model: string } | { claude: string } | { why: string }> {
  if (!existsSync(action.portal.paths.gatewayConfigFile) && !text.startsWith("claude-")) {
    return { why: "The gateway is not set up, so it has no backend for claude-mem to use." };
  }
  const parsed = parseTarget(text);
  if ("error" in parsed) return { why: parsed.error };
  if (parsed.target.kind === "anthropic") return { claude: text };
  const problem = await targetProblem(action, text);
  if (problem !== null) return { why: problem };
  return { backend: parsed.target.backend, model: parsed.target.model };
}

/** Runs one claude-mem write; a lock another command holds, or a file error, is its answer. */
async function claudeMemWrite(write: () => Promise<ChoiceResult>): Promise<ActionResult> {
  try {
    return await write();
  } catch (error) {
    return { lines: [messageOf(error)], ok: false };
  }
}

/**
 * claude-mem's route (`claudemem.route`): `claude`, or a `<backend>:<model>` from the live list.
 * The page asks first; the writer checks a backend with one tiny chat before it writes.
 */
async function claudeMemRoute(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const text = typeof body.target === "string" ? body.target.trim() : "";
  if (text === "") return { lines: ['Pick "claude" or a model from the list.'], ok: false };
  if (body.confirm !== true) return notConfirmed("saved");
  const paths = action.portal.paths;
  if (text === CLAUDE_PROVIDER) return claudeMemWrite(() => chooseRoute(paths, { kind: "claude" }));
  const target = await claudeMemTarget(action, text);
  if ("why" in target) return { lines: [target.why], ok: false };
  if ("claude" in target) {
    return {
      lines: [
        `${text} is a Claude model: pick "claude" for the Claude route (claude-mem's own Claude model).`,
      ],
      ok: false,
    };
  }
  return claudeMemWrite(() => chooseRoute(paths, { kind: "backend", ...target }));
}

/**
 * claude-mem's key (`claudemem.key`): `use: "gateway"` (the gateway's own key for that backend,
 * as setup uses it) or `use: "other"` with a pasted `key`. The key is never printed back.
 */
async function claudeMemKey(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.use !== "gateway" && body.use !== "other") {
    return { lines: ['Say which key: "gateway" or "other".'], ok: false };
  }
  if (body.confirm !== true) return notConfirmed("saved");
  const paths = action.portal.paths;
  const choice: KeyChoice =
    body.use === "gateway"
      ? { kind: "gateway" }
      : { key: typeof body.key === "string" ? body.key : "", kind: "other" };
  return claudeMemWrite(() => chooseKey(paths, choice));
}

/**
 * claude-mem's quota fallback (`claudemem.fallback`): `off`, `claude` (its own Claude model), a
 * `claude-…` model, or a `<backend>:<model>` from the live list.
 */
async function claudeMemFallback(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const text = typeof body.target === "string" ? body.target.trim() : "";
  if (text === "") {
    return { lines: ['Pick "off", "claude" or a model from the list.'], ok: false };
  }
  if (body.confirm !== true) return notConfirmed("saved");
  const paths = action.portal.paths;
  if (text === FALLBACK_OFF) return claudeMemWrite(() => chooseFallback(paths, { kind: "off" }));
  if (text === CLAUDE_PROVIDER) {
    return claudeMemWrite(() => chooseFallback(paths, { kind: "claude", model: null }));
  }
  const target = await claudeMemTarget(action, text);
  if ("why" in target) return { lines: [target.why], ok: false };
  const choice: FallbackChoice =
    "claude" in target ? { kind: "claude", model: target.claude } : { kind: "backend", ...target };
  return claudeMemWrite(() => chooseFallback(paths, choice));
}

/**
 * `claudemem.takeover` (MS1, D63): records the values the person set by hand in claude-mem's file
 * as cc-smart-dev-kit's, so the route, the key and the fallback may change. `readClaudeMemFacts`
 * says per choice whether one of them refuses it now (`refusedByHand`, `handKeys`), and the page
 * asks first, in the card's own words.
 *
 * Nothing in claude-mem's file changes: each value stays exactly as it is until the person picks
 * another, and `restore` puts it back. A key's value is never written down, so a key the kit never
 * replaced stays as it is and only the claim goes (`TAKEN_SECRET_LEFT`); one the kit replaced goes
 * with its own address (RV6, `docs/design/claude-mem.md`): the person's key comes back from a
 * backup when their address does, and the kit's key is removed when no backup holds it.
 */
async function claudeMemTakeOver(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) return notConfirmed("taken over");
  const result = await claudeMemWrite(() => takeOver(action.portal.paths));
  // Done, but a value moved while it ran and was left (its `!` line): the page keeps the words
  // until they are read, as it does for a failure.
  return result.ok && result.lines.some((line) => line.startsWith("! "))
    ? { ...result, tone: "warn" }
    : result;
}

/**
 * `claudemem.follow`: hands claude-mem back to setup (`followSetup`): the person's choices are
 * forgotten, and setup's own claude-mem step runs, so it follows the scout slot again.
 */
async function claudeMemFollow(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) return notConfirmed("changed");
  return claudeMemWrite(() => followSetup(action.portal.paths));
}

// ── The gateway's OmniRoute key (PK1) ──────────────────────────────────────────

/**
 * How to try again from the portal, in a refusal of setup's key path: per action, since a made
 * key is deleted again and was never seen, and only the paste field has the tick that saves an
 * untested key (setup's `--save-unchecked`).
 */
const KEY_WORDS = {
  key: {
    again: "paste it on the Machine page's OmniRoute card again",
    againUnchecked:
      'paste it on the Machine page\'s OmniRoute card again, or tick "Save it even if OmniRoute does not answer now" there',
  },
  password: {
    again: "make a key with your OmniRoute password on the Machine page's OmniRoute card again",
    againUnchecked:
      "make a key with your OmniRoute password on the Machine page's OmniRoute card again",
  },
} as const;
const KEY_GIVE_INSTEAD = "paste it on the Machine page's OmniRoute card";

/**
 * `gateway.key.save` (a key the person pasted) and `gateway.key.make` (a key made with
 * OmniRoute's dashboard password): `setOmnirouteKey`, setup's own key steps, so a page can never
 * save a key the command line would refuse. The key is tested first, a 401/403 refuses it and
 * keeps the key in the file, a check OmniRoute does not answer saves only with `saveUnchecked`
 * (the page's tick, `--save-unchecked`) and its `!` line, a key that changes is backed up first,
 * a key made and not saved is deleted again in OmniRoute, and the password is never stored.
 *
 * It runs in the portal's process: the secret stays in this process's memory, and never reaches
 * an argument list, the environment or a child. Every line and refusal names neither the key
 * (masked, `maskKey`) nor the password, so they are safe to answer and to send on the stream.
 */
async function gatewayKeyAction(
  action: ActionContext,
  body: Record<string, unknown>,
  from: "key" | "password",
): Promise<ActionResult> {
  const field = from === "key" ? body.key : body.password;
  // A key is trimmed, as setup trims one on stdin; a password is kept as typed, as setup's
  // terminal prompt keeps it (a space can be part of one).
  const text = typeof field === "string" ? field : "";
  const secret = from === "key" ? text.trim() : text;
  if (text.trim() === "") {
    return {
      lines: [
        from === "key"
          ? "Paste the OmniRoute API key first."
          : "Type OmniRoute's dashboard password first.",
      ],
      ok: false,
    };
  }
  if (body.confirm !== true) return notConfirmed("saved");
  const { portal } = action;
  const { lines, print } = collector();
  try {
    const saved = await setOmnirouteKey(
      { apiFetch: healthFetch(portal), paths: portal.paths, print },
      from === "key" ? { key: secret } : { password: secret },
      {
        ...KEY_WORDS[from],
        giveKey: KEY_GIVE_INSTEAD,
        // Only the paste field has the tick; a made key is saved checked or not at all.
        saveUnchecked: from === "key" && body.saveUnchecked === true,
      },
    );
    return saved.checked ? { lines, ok: true } : { lines, ok: true, tone: "warn" };
  } catch (error) {
    // The refusal first: it is what the page shows, the lines before it are its details. The
    // config's path as the success lines show it, `~/…`, not the home folder's full path.
    const config = portal.paths.gatewayConfigFile;
    const said = messageOf(error).replaceAll(config, tildify(config, portal.paths.home));
    return { lines: [...said.split("\n"), ...lines], ok: false };
  }
}

/** The refusal of an action that ends or removes something, without the page's own yes. */
function notConfirmed(what: string): ActionResult {
  return {
    lines: [`Nothing was ${what}: the page's confirmation did not come with the request.`],
    ok: false,
  };
}

/**
 * `worktrees.clean`: the command line's own `worktrees --clean`, in a child in the portal's
 * own folder, with its lines collected. The page asks first (`confirm`): every finished
 * worktree goes, and a worktree that is not finished is kept with its reason.
 */
async function cleanWorktrees(action: ActionContext): Promise<ActionResult> {
  const run = await runCliChild(action.portal, ["worktrees", "--clean"], {
    cwd: action.cwd,
    onLine: (line) => action.publish?.("action", { action: "worktrees.clean", line }),
  });
  // The list the page reads next must be the one after the clean, not the one from before it.
  forgetWorktrees(action.portal);
  const lines = [...run.lines];
  if (run.error !== null) lines.push(run.error);
  if (run.timedOut) lines.push("worktrees --clean did not answer in time");
  return { lines, ok: run.error === null && !run.timedOut && run.exitCode === 0 };
}

/** Remove only a newly revalidated unowned finished session; the CLI checks again before claude rm. */
async function removeFinishedSession(
  action: ActionContext,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  if (body.confirm !== true) return notConfirmed("removed");
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f]{8}$/.test(id))
    return { ok: false, lines: ["Pick the finished session to remove."] };
  const agents = await readPortalAgents(action.portal, action.cwd);
  const current = readFinishedSessions(action.portal.paths, {
    agents: () => agents.sessions,
    now: action.portal.now(),
  });
  if (current.error !== null) return { ok: false, lines: [current.error] };
  const session = current.sessions.find((one) => one.id === id);
  if (session === undefined)
    return {
      ok: false,
      lines: [
        "Nothing was removed: this session is no longer an eligible finished background session.",
      ],
    };
  const run = await runCliChild(
    action.portal,
    ["sessions", "--finished", "--remove", "--yes", "--id", session.id],
    {
      // Machine-wide removal must still work after the session's worktree is gone.
      cwd: action.portal.paths.home,
      onLine: (line) => action.publish?.("action", { action: "sessions.rm", line }),
    },
  );
  forgetWorktrees(action.portal);
  const lines = [...run.lines];
  if (run.error !== null) lines.push(run.error);
  if (run.timedOut)
    lines.push(
      `sessions removal did not answer in time; check ${COMMAND} sessions --finished before trying again.`,
    );
  return { lines, ok: run.error === null && !run.timedOut && run.exitCode === 0 };
}

// ── The door ────────────────────────────────────────────────────────────────────

/**
 * Every action a page may POST to `/api/<name>`: the cases of `runAction`, and `doctor.run`,
 * which the server runs itself (it keeps the pass). The portal's client sends only these
 * (`portal/src/api/wire.ts` mirrors the list, and a test runs each one).
 */
export const ACTION_NAMES = [
  "automode.apply",
  "browser.setup",
  "browser.token",
  "claudemem.fallback",
  "claudemem.follow",
  "claudemem.key",
  "claudemem.route",
  "claudemem.takeover",
  "companion.enable",
  "doctor.run",
  "gateway.key.make",
  "gateway.key.save",
  "omniroute.rollback",
  "omniroute.update",
  "project.add",
  "project.gateway.profile",
  "project.gateway.set",
  "project.preview",
  "project.workflow.propose",
  "project.write",
  "router.restart",
  "sessions.rm",
  "slot.breaker",
  "slot.check",
  "slot.effort",
  "slot.fallback",
  "slot.mode",
  "slot.save",
  "slot.test",
  "switch",
  "update.check",
  "update.install",
  "workflow.set",
  "worktrees.clean",
] as const;

/** One action's name. */
export type ActionName = (typeof ACTION_NAMES)[number];

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
  try {
    return await runActionByName(name, body, action);
  } finally {
    // The page reads that start a heavy child are kept for a few seconds (`shortCache`): an
    // action may have changed what they show, so the page that reloads after a click asks again.
    forgetPageReads(action.portal);
  }
}

async function runActionByName(
  name: string,
  body: Record<string, unknown>,
  action: ActionContext,
): Promise<ActionResult> {
  switch (name) {
    case "slot.test":
      return testTargets(action, body);
    case "slot.check":
      return checkTarget(action, body);
    case "slot.save":
      return saveSlot(action, body);
    case "slot.fallback":
      return setSlotFallback(action, body);
    case "slot.breaker":
      return setSlotBreaker(action, body);
    case "slot.effort":
      return setSlotEffort(action, body);
    case "slot.mode":
      return setSlotMode(action, body);
    case "switch": {
      const which = typeof body.name === "string" ? body.name : "";
      const on = body.on === true;
      switch (which) {
        case "gateway":
          return switchGateway(action, on);
        case "judge":
          return switchJudge(action, on);
        case "models":
          return switchModelSlots(action, on);
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
    case "claudemem.route":
      return claudeMemRoute(action, body);
    case "claudemem.key":
      return claudeMemKey(action, body);
    case "claudemem.follow":
      return claudeMemFollow(action, body);
    case "claudemem.fallback":
      return claudeMemFallback(action, body);
    case "claudemem.takeover":
      return claudeMemTakeOver(action, body);
    case "update.check":
      return updateCheck(action);
    case "update.install":
      return updateInstall(action);
    case "companion.enable":
      return companionEnable(action, typeof body.id === "string" ? body.id : "");
    case "gateway.key.save":
      return gatewayKeyAction(action, body, "key");
    case "gateway.key.make":
      return gatewayKeyAction(action, body, "password");
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
    case "project.gateway.set":
      return projectGatewaySet(action, body);
    case "project.gateway.profile":
      return projectGatewayProfile(action, body);
    case "project.workflow.propose":
      return projectWorkflowPropose(action, body);
    case "project.add":
      return projectAdd(action, body);
    case "sessions.rm":
      return removeFinishedSession(action, body);
    case "worktrees.clean":
      // The page asks first (`data-confirm`): this removes folders that hold no work.
      if (body.confirm !== true) return notConfirmed("removed");
      return cleanWorktrees(action);
    default:
      return { lines: [`"${name}" is not an action.`], ok: false };
  }
}

/** What the heavy-job queue reads through: this machine's memory, the portal's paths. */
export function jobContext(action: ActionContext): JobContext {
  return {
    cwd: action.cwd,
    execArgv: process.execArgv,
    memory: realMemoryFacts(),
    paths: action.portal.paths,
    print: () => undefined,
    say: () => undefined,
  };
}

/** The heavy-job queue's own lines, for the Machine page (the same reader as `/api/jobs`). */
export async function jobLines(action: ActionContext): Promise<{ error: string; lines: string[] }> {
  try {
    const state = await readJobs(jobContext(action));
    return {
      error: "",
      lines: statusLines(state, action.portal.paths.home, action.portal.now()),
    };
  } catch (error) {
    return { error: messageOf(error), lines: [] };
  }
}

/** The self-update's own state, read through the same files `doctor` reads. */
export function updateState(action: ActionContext): {
  held: null | { at: string; from: null | string; notes: string[]; version: string };
  heldSince: null | string;
  installed: null | string;
  last: LastCheck | null;
} {
  const files = updateFiles(action.portal.paths.stateDir);
  return {
    held: readHeldMajor(files),
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
