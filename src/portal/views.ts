/**
 * The pages themselves: plain HTML built from values, one function per screen.
 *
 * They follow the approved design (the owner's mockups, 2026-10-16), with two corrections
 * the owner asked for: the sample Bun version reads 1.4.3, and every "fix it" command is the
 * command that really works (`cc-smart-dev-kit setup --warp`,
 * `claude plugin enable frontend-design@claude-plugins-official`).
 *
 * Nothing here invents a number. Where the portal cannot know something — Claude Code's own
 * usage percentages, OmniRoute's prices — the page says so and shows what it does know.
 *
 * **No `style` attribute anywhere.** The Content-Security-Policy allows no inline style, so
 * every layout choice is a class from `assets.ts`; the one number that must be a value (a
 * meter's width) travels as a `data-` attribute and the browser script applies it.
 */

import { COMMAND } from "../build-info";
import { PLUGIN } from "../build-info/names";
import type { Check as DoctorCheck } from "../cli/doctor";
import { UNIT_NAME } from "../gateway/service";
import { JUDGE_SLOT } from "../gateway/targets";
import type { LastCheck } from "../update/state";
import type {
  BackendRow,
  CompanionRow,
  FallbackRow,
  LimitRow,
  LogLine,
  ModelRow,
  OmnirouteRow,
  RouterFacts,
  SlotRow,
  SwitchFacts,
  WarpRow,
} from "./facts";
import { barePage, command, escapeHtml, layout, type Shell, switchButton } from "./page";

/** A switch's own confirmation: every one of them changes running sessions. */
const SWITCH_CONFIRM =
  "This changes every running Claude session, from its next request. Continue?";

/** The router's unit name as a person types it: no `.service`. */
const ROUTER = UNIT_NAME.replace(/\.service$/, "");

/** The gateway is not set up, or its config cannot be read: the way forward, either way. */
export function notSetUpPage(
  shell: Shell,
  options: { backends: string[]; configError?: string },
): string {
  const error =
    options.configError === undefined
      ? ""
      : `<div class="notice">The gateway config cannot be read: <span class="mono wrap-any">${escapeHtml(options.configError)}</span>. Nothing here can change until it is fixed.</div>`;
  const body = `<div class="grid two">
<section class="card pad">
<h1 class="h1sm">The gateway is not set up.</h1>
${error}
<p class="muted">There are no slots to show yet${options.backends.length === 0 ? "" : ` (the config lists ${escapeHtml(options.backends.join(", "))}, but nothing runs)`}. Set the gateway up in a terminal, then reload this page:</p>
${command(`${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`, "Copy the setup command")}
<p class="small muted">The key comes on stdin, never on the command line: a key in argv reaches every process list on this machine.</p>
</section>
<section class="card pad">
<h2>Until then</h2>
<p class="muted">Claude Code talks to Claude directly. Machine still works, so updates, the heavy-job queue and the companions can be seen and fixed here.</p>
<a class="btn" href="/machine">Open Machine</a>
</section>
</div>`;
  return layout({ active: null, body, shell, title: "The gateway is not set up" });
}

/** The link is dead: used once already, or the portal stopped. */
export function expiredPage(): string {
  const body = `<div class="grid two">
<section class="card pad">
<h1 class="h1sm">This link has expired.</h1>
<p class="muted">It was already used, or the portal stopped. Each link works once. Run this in your own terminal for a new one:</p>
${command(`${COMMAND} portal`, "Copy the portal command")}
<p class="small muted">Not inside Claude Code: there the command refuses to print a link. Never open the portal in the browser Claude drives.</p>
</section>
</div>`;
  return barePage({ body, title: "Link expired" });
}

// ── Overview ────────────────────────────────────────────────────────────────────

export interface OverviewData {
  backends: BackendRow[];
  dashboardUrl: null | string;
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  /** False when the state file is not there or not readable. */
  limitsRead: boolean;
  router: RouterFacts;
  slots: SlotRow[];
  switches: SwitchFacts;
  warnings: LogLine[];
}

function targetsLine(slot: SlotRow): string {
  if (slot.targets.length === 0) return `<span class="muted">${escapeHtml(slot.note)}</span>`;
  const judge = slot.key === JUDGE_SLOT;
  return slot.targets
    .map((target, index) => {
      const classes = ["chip"];
      if (index === 0 && !judge) classes.push("on");
      else if (index > 0) classes.push("dashed");
      if (target.restingFor !== null) classes.push("warn");
      const inside =
        target.restingFor === null
          ? `${index === 0 && !judge ? '<span aria-hidden="true">✓</span>' : ""}${escapeHtml(target.target)}`
          : `<span aria-hidden="true">·</span>${escapeHtml(target.target)} · resting, ${Math.max(1, Math.round(target.restingFor / 60))} min left`;
      const chip = `<span class="${classes.join(" ")}">${inside}</span>`;
      return index === 0 ? chip : `<span class="arrow" aria-hidden="true">→</span>${chip}`;
    })
    .join("");
}

function overviewSlots(data: OverviewData): string {
  return data.slots
    .map(
      (slot) => `<div class="row-wide">
<div class="col w140"><span class="mono bold">${escapeHtml(slot.name)}</span><span class="small muted">${escapeHtml(slot.kind)}</span></div>
<div class="fill1">${targetsLine(slot)}</div>
</div>`,
    )
    .join("");
}

function usageCards(data: OverviewData): string {
  if (data.limits.length === 0 && data.fallbacks.length === 0) {
    return `<div class="card pad"><p class="muted">No plan limit has been seen since the router started${data.limitsRead ? "" : ", and it has written no limit state yet"}. The router records one when Anthropic refuses a Claude model at the plan's usage limit.</p>
<p class="small muted">The percentages Claude Code shows in its status line come from the headers of its own answers and are handed to the status line on stdin; nothing writes them down, so this page cannot read them.</p></div>`;
  }
  const cards = data.limits
    .map(
      (limit) => `<div class="card warn pad">
<div class="spread"><span class="bold">${escapeHtml(limit.model)}</span><span class="tag">at its plan limit</span></div>
<p class="small warncolor">Anthropic refused it at ${escapeHtml(limit.claim)}${limit.resets === null ? "" : `, resetting at ${escapeHtml(limit.resets)}`}. A model slot answers from its next target until then; without one, its work waits for the reset.</p>
</div>`,
    )
    .join("");
  const fallbacks = data.fallbacks
    .map(
      (fallback) => `<div class="card pad">
<div class="spread"><span class="bold">${escapeHtml(fallback.slot)}</span><span class="chip on">${escapeHtml(fallback.target)}</span></div>
<p class="small muted">It answers for ${escapeHtml(fallback.model)} since ${escapeHtml(fallback.since)}, and asks the model itself again until it answers.</p>
</div>`,
    )
    .join("");
  return `<div class="grid cards">${cards}${fallbacks}</div>
<p class="small muted">Claude Code shows the plan's percentages in its status line; the router records only the limits it saw, which is what these cards show.</p>`;
}

export function overviewPage(shell: Shell, data: OverviewData): string {
  const warnLines = data.warnings
    .slice(-3)
    .map(
      (line) => `<div class="logline warnrow" data-log-line data-level="${line.level}">
<span class="muted">${escapeHtml(line.time)}</span><span class="${line.level === "WARN" ? "warnmark" : "badmark"}">${escapeHtml(line.level)}</span><span class="wrap-any">${escapeHtml(line.text)}</span>
</div>`,
    )
    .join("");

  const switches = `<div class="card list">
<div class="row-wide">
<div class="col g2 fill1"><span id="sw-gw" class="bold">Gateway</span><span class="small muted">Claude Code sends its requests through the router on 127.0.0.1:${data.router.port}.</span></div>
${switchButton({ action: "switch", body: { name: "gateway", on: !data.switches.gateway }, confirm: SWITCH_CONFIRM, id: "sw-gw", label: "Gateway", on: data.switches.gateway, reload: true })}
</div>
<div class="row-wide">
<div class="col g2 fill1"><span id="sw-judge" class="bold">Your own judge</span><span class="small muted">${data.switches.judgeUntested ? "A target has not passed the force-push test, so the router ignores it." : "Off: Claude judges auto mode's safety check. It turns on only with a saved, fully force-push-tested chain."}</span></div>
${switchButton({ action: "switch", body: { name: "judge", on: !data.switches.judge }, confirm: SWITCH_CONFIRM, id: "sw-judge", label: "Your own judge", on: data.switches.judge, reload: true })}
</div>
<div class="row-wide">
<div class="col g2 fill1"><span id="sw-fb" class="bold">opus and fable fallback</span><span class="small muted">At the plan limit, the next target answers until the reset.</span></div>
${switchButton({ action: "switch", body: { name: "fallback", on: !data.switches.fallback }, confirm: SWITCH_CONFIRM, id: "sw-fb", label: "opus and fable fallback", on: data.switches.fallback, reload: true })}
</div>
<div class="foot">A switch changes every running Claude session from its next request. You confirm first.</div>
<div class="foot" data-out-for="switch" role="status"></div>
${data.switches.warnings.map((warning) => `<div class="foot warncolor">! ${escapeHtml(warning)}</div>`).join("")}
</div>`;

  const body = `<div class="pagehead">
<div>
<h1>Overview</h1>
<p>The same facts as <code>${COMMAND} gateway status</code> and the router's health page.</p>
</div>
${data.dashboardUrl === null ? "" : `<a class="btn" href="${escapeHtml(data.dashboardUrl)}" rel="noreferrer">OmniRoute dashboard</a>`}
</div>

<section aria-labelledby="usage-h">
<h2 id="usage-h">Usage limits</h2>
${usageCards(data)}
</section>

<section aria-labelledby="slots-h">
<div class="spread"><h2 id="slots-h">Slots</h2><a href="/slots">Edit slots</a></div>
<div class="card list">${data.slots.length === 0 ? '<p class="muted">No slots in the config.</p>' : overviewSlots(data)}</div>
</section>

<div class="grid two">
<section aria-labelledby="switch-h">
<h2 id="switch-h">Switches</h2>
${switches}
</section>

<section aria-labelledby="warn-h">
<div class="spread"><h2 id="warn-h">Latest warnings</h2><a href="/health">Open the full log</a></div>
<div class="card scrollx">
<div class="minw520 col">${warnLines === "" ? '<div class="logline"><span class="muted">Nothing warned since the router started.</span></div>' : warnLines}</div>
</div>
</section>
</div>

<nav aria-label="Other screens" class="tiles">
<a class="tile" href="/slots"><b>Slots</b><span class="small muted">Change a chain of models. Test, then save.</span></a>
<a class="tile" href="/health"><b>Health</b><span class="small muted">Backends, fallbacks, resting targets, the log.</span></a>
<a class="tile" href="/machine"><b>Machine</b><span class="small muted">Updates, heavy jobs, companions, doctor.</span></a>
</nav>`;
  return layout({ active: "overview", body, shell, title: "Overview" });
}

// ── Slots ───────────────────────────────────────────────────────────────────────

export interface SlotsData {
  /** Why a backend's models are not listed, per backend. */
  backendNotes: string[];
  chains: Record<string, string[]>;
  models: ModelRow[];
  slots: SlotRow[];
  /** `"<slot>\u0000<target>"` → `blocked` for a judge target that passed. */
  tested: Record<string, string>;
}

export function slotsPage(shell: Shell, data: SlotsData): string {
  const picks = data.slots
    .map(
      (slot, index) =>
        `<button type="button" class="slotpick" data-pick="${escapeHtml(slot.name)}" data-info="${escapeHtml(slot.info)}" aria-pressed="${index === 0}"><span class="mono bold">${escapeHtml(slot.name)}</span><span>${escapeHtml(slot.kind)}</span></button>`,
    )
    .join("");
  const modelRows = data.models
    .map(
      (
        model,
      ) => `<div class="rowline cols-models" data-model-row data-model="${escapeHtml(model.id)}">
<span class="mono wrap-any">${escapeHtml(model.id)}</span>
<span>${escapeHtml(model.backend)}</span>
<span class="num">${escapeHtml(model.context)}</span>
<span class="row end"><button type="button" class="btn primary" data-add="${escapeHtml(model.id)}">Add</button></span>
</div>`,
    )
    .join("");
  const first = data.slots[0];
  const body = `<div class="pagehead">
<div>
<h1>Slots</h1>
<p>A slot is a chain of models. The first target answers; the next one answers only if it fails or rests. Same checks as <code>${COMMAND} gateway slot</code>.</p>
</div>
</div>

<div data-slots data-slot="${escapeHtml(first?.name ?? "scout")}" data-chains="${escapeHtml(JSON.stringify(data.chains))}" data-tested="${escapeHtml(JSON.stringify(data.tested))}">

<section aria-labelledby="pick-h">
<h2 id="pick-h" class="h2sm">Pick a slot</h2>
<div class="slotpicks">${picks}</div>
</section>

<section class="card pad">
<div class="col g4">
<h2><span class="mono" data-slotname>${escapeHtml(first?.name ?? "scout")}</span> slot</h2>
<p class="muted" data-slotinfo>${escapeHtml(first?.info ?? "")}</p>
</div>

<div class="notice" data-judge-note ${first?.name === "judge" ? "" : "hidden"}>
<div class="col g4">
<span class="bold">The force-push test. There is no skip.</span>
<span>Each backend target is asked to judge <code>git push --force origin main</code>; a target that does not block it cannot be saved, and Save stays off until every one of them shows blocked ✓.</span>
<span class="small">A <code>claude-…</code> target is allowed here, exactly as the command line allows it, and it is never used as a judge: the router uses a judge target only after that test, and a Claude target cannot be tested from this page. Another slot has no such rule — Save is on there, and the same checks run when it saves.</span>
</div>
</div>

<div class="col g8">
<h3>Chain, in order</h3>
<ul class="chain" data-chain></ul>
</div>

<div class="row">
<button type="button" class="btn primary" data-test>Test each target</button>
<button type="button" class="btn strong" data-save>Save</button>
</div>

<div class="confirmbox" data-confirm-save hidden>
<p><b>Save this slot?</b> Every running Claude session uses it from its next request.</p>
<div class="row">
<button type="button" class="btn strong" data-confirm-yes>Save for every session</button>
<button type="button" class="btn" data-confirm-no>Cancel</button>
</div>
</div>

<div data-out role="status"></div>
</section>

<section class="card pad">
<div class="spread">
<div>
<h2>Live model list</h2>
<p class="muted">What each backend lists, and the Claude models the config names. The context length comes from the backend's own list; prices and image support are in OmniRoute's own catalog and are not read here.</p>
</div>
<div class="row"><input type="search" class="search" data-find placeholder="glm, deepseek, claude…" aria-label="Find a model"></div>
</div>
${data.backendNotes.map((note) => `<p class="notice">${escapeHtml(note)}</p>`).join("")}
<div class="table"><div class="inner" data-models>
<div class="head cols-models"><span>Model</span><span>From</span><span>Context</span><span></span></div>
${modelRows === "" ? '<div class="rowline"><span class="muted">No models listed.</span></div>' : modelRows}
</div></div>
<p class="small muted">“Claude login” means the model runs on your own Claude plan, so there is no price per token. Keys are never sent to this page.</p>
</section>
</div>`;
  return layout({ active: "slots", body, shell, title: "Slots" });
}

// ── Health ──────────────────────────────────────────────────────────────────────

export interface HealthData {
  backends: BackendRow[];
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  log: { lines: LogLine[]; note: null | string };
  router: RouterFacts;
}

export function healthPage(shell: Shell, data: HealthData): string {
  const backends = data.backends
    .map(
      (backend) => `<div class="row-wide">
<span class="flex1 bold">${escapeHtml(backend.name)}</span>
${backend.state === "answers" ? '<span class="ok">✓ answering</span>' : '<span class="badmark">✗ not answering</span>'}
<span class="small muted num">${backend.ms === null ? escapeHtml(backend.why ?? "") : `${backend.ms} ms`}</span>
<span class="small muted wrap-any">${escapeHtml(backend.url)}</span>
</div>`,
    )
    .join("");
  const logLines = data.log.lines
    .slice(-120)
    .map(
      (
        line,
      ) => `<div class="logline cols-log${line.level === "WARN" ? " warn" : ""}" data-log-line data-level="${line.level}">
<span class="muted">${escapeHtml(line.time)}</span><span>${escapeHtml(line.level)}</span><span class="wrap-any">${escapeHtml(line.text)}</span>
</div>`,
    )
    .join("");
  const resting = data.router.cooling
    .map(
      (entry) => `<div class="row-wide">
<div class="col g2 fill1"><span class="mono wrap-any">${escapeHtml(entry[0])}</span><span class="small muted">a target that did not answer; the next one in its chain answers meanwhile</span></div>
<span class="tag">${Math.round(entry[1])} s left</span>
</div>`,
    )
    .join("");
  const downCard =
    data.router.up === true
      ? ""
      : `<section class="card bad">
<h2 class="badmark">✗ The router is not answering</h2>
<p class="muted">Nothing came back from 127.0.0.1:${data.router.port} (${escapeHtml(data.router.why ?? "no answer")}). Subagents on the affordable slots may fail until it is back. Check it in a terminal:</p>
${command(`systemctl --user status ${ROUTER}`, "Copy the status command")}
${command(`journalctl --user -u ${ROUTER} -f`, "Copy the log command")}
<div class="row"><button type="button" class="btn primary" data-action="router.restart" data-confirm="A restart lets the answers in flight finish first (up to 120 s). New requests wait in its socket meanwhile; none fails. Continue?" data-reload>Restart the router</button></div>
<div data-out-for="router.restart" role="status"></div>
<p class="small muted">This page tries again every 5 seconds.</p>
</section>`;

  const body = `<div class="pagehead" data-live>
<div>
<h1>Health</h1>
<p>${data.router.up ? `Since the router started, ${escapeHtml(String(data.router.uptimeSec))} s ago.` : "The router is not answering."} The page looks again every 5 seconds.</p>
</div>
</div>

<section aria-label="Counters" class="grid stats">
<div class="card stat"><span class="label">Requests</span><span class="value num">${escapeHtml(data.router.requests.toLocaleString("en-US"))}</span></div>
<div class="card stat"><span class="label">Fallbacks</span><span class="value num">${escapeHtml(data.router.fallbacks.toLocaleString("en-US"))}</span><span class="small muted">a next target answered</span></div>
<div class="${data.router.cooling.length > 0 ? "stat warn" : "card stat"}"><span class="label">Resting now</span><span class="value num">${data.router.cooling.length}</span><span class="small ${data.router.cooling.length > 0 ? "" : "muted"}">target${data.router.cooling.length === 1 ? "" : "s"}</span></div>
<div class="card stat"><span class="label">Plan limits seen</span><span class="value num">${data.limits.length}</span><span class="small muted">Claude models at their limit</span></div>
</section>

<div class="grid two">
<section aria-labelledby="be-h">
<h2 id="be-h">Backends</h2>
<div class="card list">${backends === "" ? '<p class="muted">The config names no backend.</p>' : backends}</div>
</section>
<section aria-labelledby="rest-h">
<h2 id="rest-h">Resting targets</h2>
<div class="card">${resting === "" ? '<p class="footnote muted">Nothing is resting.</p>' : `<div class="card list">${resting}</div>`}
<p class="foot">While a target rests, the next target in its chain answers.</p></div>
</section>
</div>

<section aria-labelledby="log-h">
<div class="spread">
<div><h2 id="log-h">Log</h2><p class="small muted">One line per request, straight from the router's journal. Keys are always masked.</p></div>
<div class="row">
<label class="row tap"><input type="checkbox" data-only-warn> Only WARN lines</label>
<button type="button" class="btn" data-pause>Pause</button>
</div>
</div>
<div class="card scrollx">
<div class="minw760 col">${logLines === "" ? '<div class="logline"><span class="muted">No log lines yet.</span></div>' : logLines}</div>
</div>
${data.log.note === null ? "" : `<p class="small muted">${escapeHtml(data.log.note)}</p>`}
<p class="small muted">The full log, in a terminal: <code>journalctl --user -u ${ROUTER} -f</code></p>
</section>
${downCard}`;
  return layout({ active: "health", body, shell, title: "Health" });
}

// ── Machine ─────────────────────────────────────────────────────────────────────

/** What the Machine page shows about the self-update. */
export interface UpdateFacts {
  heldSince: null | string;
  installed: null | string;
  last: LastCheck | null;
  newest: null | string;
  /** One line saying what the last check found. */
  summary: string;
}

export interface MachineData {
  autoMode: null | { entries: string[]; from: string; settings: string };
  companions: CompanionRow[];
  doctor: { at: number; checks: DoctorCheck[] } | null;
  jobs: null | { error: string; lines: string[] };
  omniroute: OmnirouteRow;
  updates: UpdateFacts;
  warp: WarpRow;
}

function clockFrom(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(new Date(ms));
}

/** The words a companion's state is shown in, in the design's own style. */
const COMPANION_WORDS: Readonly<Record<string, string>> = {
  "no-marketplace": "marketplace missing",
  "not-installed": "missing",
  off: "off",
  "outside-range": "outside the version range",
  "unknown-version": "version unknown",
};

function companionCard(companion: CompanionRow): string {
  const tone = companion.state === "ok" ? "" : " warn";
  return `<div class="card pad${tone}">
<div class="spread"><span class="mono bold">${escapeHtml(companion.title)}</span><span class="${companion.state === "ok" ? "ok" : "warnmark"}">${companion.state === "ok" ? "✓ installed" : escapeHtml(COMPANION_WORDS[companion.state] ?? companion.state)}</span></div>
<span class="small">${escapeHtml(companion.detail)}</span>
${
  companion.enableArgv === null
    ? '<span class="small muted">Nothing to fix here: the marketplace and the plugin steps need a terminal.</span>'
    : `${command(companion.command ?? "", `Copy the command that turns ${companion.id} on`)}
<div class="row"><button type="button" class="btn primary" data-action="companion.enable" data-body="${escapeHtml(JSON.stringify({ id: companion.id }))}" data-confirm="Turn ${escapeHtml(companion.id)} on in Claude Code? A plugin turned off is a choice; this is the same command the CLI prints." data-reload>Turn it on here</button></div>
<div data-out-for="companion.enable" role="status"></div>`
}
</div>`;
}

export function machinePage(shell: Shell, data: MachineData): string {
  const omniroute = data.omniroute;
  const install = omniroute.install;
  const previous = omniroute.previous;
  const omnirouteCard = `<section class="card pad">
<div class="spread"><h2>OmniRoute</h2><code class="small">${COMMAND} omniroute status</code></div>
${
  install === null
    ? `<p class="muted">Not installed here, so the affordable slots have no backend. Install it in your own terminal, then run <code>${COMMAND} gateway setup</code>:</p>${command(`bun add -g ${"omniroute"}`, "Copy the install command")}`
    : `<div class="kv">
<div class="item"><span class="label">Installed</span><span class="value mono">${escapeHtml(install.version)}</span></div>
<div class="item"><span class="label">Newest, 3 days old</span><span class="value mono">${omniroute.newestVersion === null ? "(not read)" : `${escapeHtml(omniroute.newestVersion)}${omniroute.state === "ok" ? ' <span class="ok">✓</span>' : ""}`}</span></div>
<div class="item"><span class="label">Unit</span><span class="value mono">${omniroute.unit === null ? "(none)" : escapeHtml(omniroute.unit)}</span></div>
<div class="item"><span class="label">Backend</span><span class="value mono small">${omniroute.backend === null ? "(none in the config)" : escapeHtml(omniroute.backend)}</span></div>
</div>
${omniroute.registryError === null ? "" : `<p class="notice">The npm registry could not be read: ${escapeHtml(omniroute.registryError)}</p>`}
<p class="muted">The update restarts it, so the gateway's slots fall to their next target while it comes back: Claude answers, on your own login. A version that does not answer is put back.</p>
<div class="row">
<button type="button" class="btn primary" data-action="omniroute.update" data-confirm="Install the newest release and restart the model path? While it restarts, the gateway's slots fall to their next target — Claude answers, on your own login." data-reload>${omniroute.state === "behind" ? `Update to ${escapeHtml(omniroute.newestVersion ?? "")}` : "Update"}</button>
<button type="button" class="btn" data-action="omniroute.rollback" data-confirm="Put the version the last update replaced back, and restart the model path?" data-reload>Roll back</button>
</div>
<div data-out-for="omniroute.update" role="status"></div>
<div data-out-for="omniroute.rollback" role="status"></div>
${previous === null ? "" : `<p class="small muted">The last update here replaced ${escapeHtml(previous.version)} (${escapeHtml(previous.at.slice(0, 19))}Z).</p>`}`
}
</section>`;

  const jobsCard = `<section class="card pad">
<div class="spread"><h2>Heavy-job queue</h2><code class="small">${COMMAND} job status</code></div>
${
  data.jobs === null
    ? '<p class="muted">The queue could not be read.</p>'
    : `<div class="mono small col g2">${data.jobs.lines.map((line) => `<span class="wrap-any">${escapeHtml(line)}</span>`).join("")}</div>${data.jobs.error === "" ? "" : `<p class="notice">${escapeHtml(data.jobs.error)}</p>`}`
}
<p class="small muted">Each job reserves its gigabytes and waits its turn in one machine-wide queue.</p>
</section>`;

  const doctor = data.doctor;
  const failed = doctor === null ? 0 : doctor.checks.filter((check) => !check.ok).length;
  const doctorCard = `<section class="card pad">
<div class="spread">
<div>
<h2>Doctor</h2>
<p class="small muted">The same checks as <code>${COMMAND} doctor</code>.${doctor === null ? " Not run yet." : ` Ran at ${escapeHtml(clockFrom(doctor.at))}. ${failed === 0 ? "Every check passed." : `${doctor.checks.length - failed} passed, ${failed} to fix.`}`}</p>
</div>
<button type="button" class="btn primary" data-action="doctor.run" data-reload>Run again</button>
</div>
${
  doctor === null
    ? '<p class="muted">Open this page again once it has run.</p>'
    : `<ul class="checks">${doctor.checks
        .map(
          (check) =>
            `<li class="${check.ok ? "" : "fail"}"><span class="mark ${check.ok ? "ok" : "badmark"}" aria-hidden="true">${check.warn === true ? "!" : check.info === true ? "·" : check.ok ? "✓" : "✗"}</span><span class="wrap-any">${escapeHtml(check.text)}</span></li>`,
        )
        .join("")}</ul>`
}
<div data-out-for="doctor.run" role="status"></div>
</section>`;

  const autoMode =
    data.autoMode === null
      ? ""
      : `<section class="card pad">
<h2>Auto mode: trust rules</h2>
<p class="muted">These come from <span class="mono">${escapeHtml(data.autoMode.from)}</span> and go into <span class="mono">${escapeHtml(data.autoMode.settings)}</span>, the only place Claude Code's auto mode reads them from. They are trust rules: read them before you say yes.</p>
<ul class="checks">${data.autoMode.entries.map((entry) => `<li><span class="mark">+</span><span class="wrap-any">${escapeHtml(entry)}</span></li>`).join("")}</ul>
<div class="row"><button type="button" class="btn primary" data-action="automode.apply" data-body="${escapeHtml(JSON.stringify({ confirm: true }))}" data-confirm="Write these trust rules into Claude Code's user settings? Auto mode will treat them as true." data-reload>Write them</button></div>
<div data-out-for="automode.apply" role="status"></div>
</section>`;

  const body = `<div class="pagehead">
<div>
<h1>Machine</h1>
<p>Updates, heavy jobs and the programs this kit needs, on this computer.</p>
</div>
</div>

<div class="grid two">
<section class="card pad">
<h2>Updates</h2>
<div class="kv">
<div class="item"><span class="label">Installed</span><span class="value mono">${escapeHtml(data.updates.installed ?? "(not installed)")}</span></div>
<div class="item"><span class="label">Newest in the marketplace</span><span class="value mono">${escapeHtml(data.updates.newest ?? "(not read)")}${data.updates.newest !== null && data.updates.newest === data.updates.installed ? ' <span class="ok">✓</span>' : ""}</span></div>
<div class="item"><span class="label">Last check</span><span class="value">${escapeHtml(data.updates.last === null ? "never" : data.updates.last.at.slice(0, 16).replace("T", " "))}</span></div>
</div>
<p class="muted">${escapeHtml(data.updates.summary)}</p>
<div class="row-wide">
<div class="col g2 fill1"><span id="sw-hold" class="bold">On hold</span><span class="small muted">When on, no update installs until you turn it off.</span></div>
${switchButton({ action: "switch", body: { name: "hold", on: data.updates.heldSince === null }, confirm: `This stops the background check for a newer ${PLUGIN} on this machine, or starts it again. Continue?`, id: "sw-hold", label: "On hold", on: data.updates.heldSince !== null, reload: true })}
</div>
<div class="row">
<button type="button" class="btn primary" data-action="update.check">Check now</button>
<button type="button" class="btn" data-action="update.install" data-confirm="Install a newer version now? Nothing restarts: the running sessions load it when they restart." data-reload>Install an update</button>
</div>
<div data-out-for="update.check" role="status"></div>
<div data-out-for="update.install" role="status"></div>
<p class="small muted">The kit updates itself in the background. Running sessions pick up a new version when they restart.</p>
</section>
${jobsCard}
</div>

<section aria-labelledby="comp-h">
<h2 id="comp-h">Companions</h2>
<div class="grid cards">${data.companions.map(companionCard).join("")}</div>
</section>

<section aria-labelledby="warp-h" class="card pad">
<div class="spread"><h2 id="warp-h">Warp terminal</h2><span class="${data.warp.installed ? "ok" : "muted"}">${data.warp.installed ? "✓ installed" : "not installed"}</span></div>
<p class="muted">${escapeHtml(data.warp.detail)}</p>
<p class="small muted">Both commands need <span class="mono">sudo</span>, which this page never runs: copy one into your own terminal. <span class="mono">${COMMAND} setup --warp</span> shows each step and asks before it changes anything.</p>
${command(`${COMMAND} setup --warp`, "Copy the Warp install command")}
${command(`${COMMAND} setup --remove-warp`, "Copy the Warp remove command")}
</section>

${omnirouteCard}
${doctorCard}
${autoMode}
${
  shell.facts.router.up
    ? ""
    : `<section class="card bad">
<h2 class="badmark">✗ The router is not answering</h2>
<p class="muted">The gateway is set up, but nothing answers on 127.0.0.1:${shell.facts.router.port}. See the Health page for the log and the restart.</p>
<a class="btn" href="/health">Open Health</a>
</section>`
}`;
  return layout({ active: "machine", body, shell, title: "Machine" });
}

// ── How this page stays private ─────────────────────────────────────────────────

/** A row of plain cards, under a numbered heading. */
function privacyStep(n: number, title: string, cells: { text: string; tone?: string }[]): string {
  return `<section>
<h2 class="h2sm">${n} · ${escapeHtml(title)}</h2>
<div class="grid cards">${cells
    .map(
      (cell) =>
        `<div class="card pad${cell.tone === undefined ? "" : ` ${cell.tone}`}"><span>${cell.text}</span></div>`,
    )
    .join("")}</div>
</section>`;
}

/** The security page: the design in plain words, with this run's own numbers in it. */
export function privacyPage(shell: Shell, options: { routerPort: number }): string {
  const port = shell.facts.portalPort;
  const body = `<div class="pagehead">
<div>
<h1>How the portal stays private</h1>
<p>This run listens on <span class="mono">127.0.0.1:${port}</span>, and the router on <span class="mono">127.0.0.1:${options.routerPort}</span>.</p>
</div>
</div>

${privacyStep(1, "Starting the portal: for the person, not for Claude", [
  { text: `You run <span class="mono">${COMMAND} portal</span> in your own terminal.` },
  {
    text: 'Run inside a Claude Code session? <b>✗ Refused, no link.</b> "Run it in your own terminal."',
    tone: "warn",
  },
  {
    text: `It prints a one-time link <span class="mono">127.0.0.1:${port}/?t=…</span>, and your default browser opens it.`,
  },
  {
    text: "The portal changes the session's own model path and the safety judge. Claude must never do that for itself, and you should never open the portal in the browser Claude drives.",
    tone: "warn",
  },
])}

${privacyStep(2, "Every request to the portal", [
  {
    text: 'The portal binds <span class="mono">127.0.0.1</span> only, so no other computer can reach it.',
  },
  {
    text: `The <span class="mono">Host</span> header must be exactly <span class="mono">127.0.0.1:${port}</span> or <span class="mono">localhost:${port}</span>. Anything else is <b>✗ 403</b>: that is where DNS rebinding stops.`,
    tone: "warn",
  },
  {
    text: 'A request that carries a foreign <span class="mono">Origin</span> is <b>✗ 403</b> as well.',
  },
  {
    text: 'The first load exchanges the one-time token for a session cookie (<span class="mono">HttpOnly</span>, <span class="mono">SameSite=Strict</span>) and the URL is cleaned. A token cannot be used twice.',
  },
  {
    text: `The cookie's name carries this portal's port (<span class="mono">ccsdk_portal_${port}</span>), because a cookie has no port and a browser sends every <span class="mono">127.0.0.1</span> cookie to every port on it. Two portals on two ports therefore hold their own sessions. Either way it is sent only to this machine: it is never <span class="mono">Secure</span>, because this is http on <span class="mono">127.0.0.1</span>.`,
  },
  {
    text: 'A change (a POST) must carry the CSRF token that came with the page, and an <span class="mono">Origin</span> of ours. Otherwise <b>✗ 403</b> and nothing changes.',
    tone: "warn",
  },
  { text: "A change runs through the same functions as the CLI, with the same checks." },
  {
    text: "Thirty minutes with no request and the portal stops by itself: the link and the cookie are dead after that.",
  },
])}

${privacyStep(3, "Always true", [
  { text: "<b>127.0.0.1 only.</b> The portal binds nothing else." },
  {
    text: '<b>Keys stay hidden.</b> A full key never reaches the page; it shows its last four characters and nothing else (<span class="mono">••••a1b2</span>).',
  },
  {
    text: "<b>No outside request.</b> The policy allows this machine and nothing else: no web font, no script, nothing from the internet.",
  },
  {
    text: "<b>You confirm first.</b> A saved slot or a switch changes every running Claude session.",
  },
])}`;
  return layout({ active: null, body, shell, title: "How the portal stays private" });
}
