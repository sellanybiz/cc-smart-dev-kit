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

import type { BrowserGuide } from "../browser/setup";
import { COMMAND } from "../build-info";
import { PLUGIN } from "../build-info/names";
import type { Check as DoctorCheck } from "../cli/doctor";
import { UNIT_NAME } from "../gateway/service";
import { JUDGE_SLOT } from "../gateway/targets";
import type { LastCheck } from "../update/state";
import {
  type BackendRow,
  type BrowserCardData,
  type CompanionRow,
  type FallbackRow,
  type LimitRow,
  type LogLine,
  type ModelRow,
  type OmnirouteRow,
  type ProjectCardData,
  type RouterFacts,
  type SettingsData,
  type SlotRow,
  type SwitchFacts,
  settingsLineNote,
  type WarpRow,
} from "./facts";
import { barePage, command, escapeHtml, LOCK_ICON, layout, type Shell, switchButton } from "./page";
import { SETTINGS_CARDS, type SettingChoice, type SettingsRow } from "./settings";
import type { ProjectInitAnswers, ProjectInitPlan, WorkflowSource } from "./workflow-adapter";

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
<p class="small muted">Not inside Claude Code: there the command refuses to print a link. Never open the portal in the Chrome profile Claude drives: its own, named <span class="mono">claude-code</span>.</p>
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

// ── Settings ────────────────────────────────────────────────────────────────────

/** The words a row's source tag shows, the design's own. */
const SOURCE_WORDS: Readonly<Record<WorkflowSource, string>> = {
  default: "default",
  personal: "yours",
  project: "this project",
};

/** Where a write into the project's committed file asks first. */
const PROJECT_SETTING_CONFIRM =
  "Write this into the project's .claude/cc-smart-dev-kit.json? It is a file the team shares: commit it like any change.";

/** The one line a row the project sets shows, with the link to where it is changed. */
const CHANGE_IN_PROJECT = `<a class="small bold projectlink" href="/machine#project">change it in the project</a>`;

function settingControl(row: SettingsRow, disabled: boolean): string {
  switch (row.kind) {
    case "boolean":
      return switchButton({
        action: "workflow.set",
        body:
          row.where === "project"
            ? { confirm: true, key: row.key, value: row.value !== true }
            : { key: row.key, value: row.value !== true },
        ...(row.where === "project" ? { confirm: PROJECT_SETTING_CONFIRM } : {}),
        disabled,
        id: row.id,
        label: row.label,
        on: row.value === true,
        reload: true,
      });
    case "segment":
      return `<div role="group" aria-labelledby="${row.id}" class="segment">${(row.choices ?? [])
        .map((choice: SettingChoice) => {
          const pressed = row.value === choice.value;
          const action = disabled
            ? " disabled"
            : ` data-action="workflow.set" data-body="${escapeHtml(JSON.stringify({ key: row.key, value: choice.value }))}" data-reload`;
          return `<button type="button" aria-pressed="${pressed}"${action}>${escapeHtml(choice.label)}</button>`;
        })
        .join("")}</div>`;
    case "events": {
      // The resolver's value, taken as the list of names it is: anything else is no name.
      const chosen = Array.isArray(row.value)
        ? row.value.filter((one): one is string => typeof one === "string")
        : [];
      return `<div role="group" aria-labelledby="${row.id}" class="row events"${disabled ? "" : ` data-events="${row.key}"`}>${(
        row.choices ?? []
      )
        .map(
          (choice) =>
            `<label class="row tap"><input type="checkbox" value="${escapeHtml(choice.value)}"${chosen.includes(choice.value) ? " checked" : ""}${disabled ? " disabled" : ""}>${escapeHtml(choice.label)}</label>`,
        )
        .join("")}</div>`;
    }
    case "number":
      return `<div class="row numrow"><input type="number" min="1" max="100" value="${escapeHtml(String(row.value))}" aria-labelledby="${row.id}" class="numinput"${disabled ? " disabled" : ` data-setting="${row.key}"`}><span class="small">%</span></div>`;
  }
}

/** One row: its words, its control, where the value comes from, and a box under it if it has one. */
function settingRow(row: SettingsRow, extra = ""): string {
  const disabled = row.readOnly;
  const control = settingControl(row, disabled);
  return `<div class="setrow">
<div class="col g2 fill1"><span id="${row.id}" class="bold">${escapeHtml(row.label)}</span><span class="small muted">${escapeHtml(row.help)}</span></div>
${disabled ? `<div class="col end g4">${control}${CHANGE_IN_PROJECT}</div>` : control}
<span class="src ${row.source}">${escapeHtml(SOURCE_WORDS[row.source])}</span>
${extra}
</div>`;
}

/** The auto-merge row's own rule box: the design's words, with the project's base named. */
function autoMergeBox(data: SettingsData): string {
  const base = data.autoMerge?.base;
  const inside = base === null || base === undefined ? "" : ` (${escapeHtml(base)} here)`;
  // The rule is the design's sentence, word for word; the line under it is what the module's
  // own `autoMergeAllowed` answers for this project right now, on its own line.
  const decided =
    data.autoMerge === null
      ? ""
      : `<span class="small rulemore">${
          data.autoMerge.allowed
            ? `On this project, a pull request into ${escapeHtml(base ?? "")} may be merged by itself, once CI is green and the review is done.`
            : "On this project it will not merge by itself: only a plain integration branch is ever merged into without asking you."
        }</span>`;
  return `<div class="rulebox">
<span class="ruleicon" aria-hidden="true">${SHIELD_ICON}</span>
<span>Only into the project's integration branch${inside}, after CI is green and the review is done. Never main, a release branch or production: those always ask you.${decided}</span>
</div>`;
}

const SHIELD_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"></path><path d="M12 9v4"></path><path d="M12 16h.01"></path></svg>`;

/**
 * The Settings page: what Claude does after a step, what alerts the person, and the switches
 * for this computer — each row with the value now and where it came from (`yours`,
 * `this project`, `default`). A row the project sets is read-only here and says where to
 * change it; the footer says the rule once (the project's choice wins).
 */
export function settingsPage(shell: Shell, data: SettingsData): string {
  const cards = SETTINGS_CARDS.map(({ card, title }) => {
    const rows = data.rows.filter((row) => row.card === card);
    return `<section aria-labelledby="${card}-h">
<h2 id="${card}-h">${escapeHtml(title)}</h2>
<div class="card list" data-scope>
${rows.map((row) => settingRow(row, row.key === "autoMerge" ? autoMergeBox(data) : "")).join("")}
<div class="foot" data-out-for="workflow.set" role="status"></div>
</div>
</section>`;
  }).join("");

  const body = `<div class="pagehead">
<div>
<h1>Settings</h1>
<p>What Claude does after it finishes a step, what alerts you, and the switches for this computer. Each row says where its value comes from.</p>
</div>
</div>
${
  data.error === null
    ? ""
    : `<div class="notice">The workflow settings cannot be read: <span class="mono wrap-any">${escapeHtml(data.error)}</span>. Nothing here can change until it is fixed.</div>`
}
${data.projectNote === null ? "" : `<p class="muted">${escapeHtml(data.projectNote)}</p>`}
${cards}
<p class="note" id="proj-wins">Your choices are saved on this computer for every project. A project can set its own in <code>.claude/cc-smart-dev-kit.json</code>; there, the project's choice wins.</p>`;
  return layout({ active: "settings", body, shell, title: "Settings" });
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
  /** The browser's own card: the guide, its state, and doctor's browser lines. */
  browser: BrowserCardData;
  companions: CompanionRow[];
  /** Why `gateway.json` cannot be used, when it is there but unreadable (never for a missing one). */
  configError?: string;
  doctor: { at: number; checks: DoctorCheck[] } | null;
  jobs: null | { error: string; lines: string[] };
  omniroute: OmnirouteRow;
  /** The card about the repo the portal was started in, and the form that sets it up. */
  project: ProjectCardData;
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

/** A remove button: the design's ✕, 44px, and its own label for a reader of the markup. */
const X_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>`;

/** The copy glyph, beside the design's Copy label. */
const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a1 1 0 0 1 1-1h10"></path></svg>`;

function removeButton(attribute: string, label: string): string {
  return `<button type="button" class="btn icon" ${attribute} aria-label="${escapeHtml(label)}">${X_ICON}</button>`;
}

/**
 * One `prefix → base` row of the form. Its two values are boxes, so a detected default can be
 * fixed rather than only removed. Empty is the template the page's script clones for `+ add`,
 * which is why the remove button's own label says "this rule" then.
 */
function baseRow(prefix: string, base: string): string {
  const remove = prefix === "" ? "Remove this rule" : `Remove the ${prefix} rule`;
  return `<div class="baserow" data-base-row>
<input class="chipinput mono" data-base-prefix value="${escapeHtml(prefix)}" aria-label="The branch-name prefix" placeholder="hotfix/">
<span aria-hidden="true" class="muted">→</span>
<input class="chipinput mono" data-base-value value="${escapeHtml(base)}" aria-label="The base a branch with that prefix starts from" placeholder="main">
${removeButton("data-remove-row", remove)}
</div>`;
}

/** One protected branch: a chip with the lock, its name in a box, and its remove button. */
function protectedChip(name: string): string {
  const remove = name === "" ? "Remove this branch" : `Remove ${name} from the protected branches`;
  return `<span class="chip lockchip" data-chip>${LOCK_ICON}<input class="chipinput mono" data-protected-name value="${escapeHtml(name)}" aria-label="A protected branch" placeholder="main">${removeButton("data-remove-chip", remove)}</span>`;
}

/** One guard row: a switch the form flips, with no action behind it (`data-form-switch`). */
function guardRow(options: {
  help: string;
  id: string;
  label: string;
  name: string;
  on: boolean;
}): string {
  return `<div class="setrow">
<div class="col g2 fill1"><span id="${options.id}" class="bold">${escapeHtml(options.label)}</span><span class="small muted">${escapeHtml(options.help)}</span></div>
<button type="button" role="switch" aria-checked="${options.on}" aria-labelledby="${options.id}" class="switch" data-form-switch="${options.name}"><span class="track" aria-hidden="true"><span class="knob"></span></span><span data-switch-label>${options.on ? "On" : "Off"}</span></button>
</div>`;
}

/**
 * One code box: the Copy button — and the box's own short label, when it has one — on a head,
 * then the text itself on its own line. One component, so the Project card's two previews and
 * the Browser card's steps can never draw two different Copy buttons.
 *
 * `attribute` is the `data-…` attribute the text carries. The button holds it as the attribute
 * selector `[data-…]`: a bare `data-preview-file` is a TAG name to `querySelector`, matches
 * nothing, and the button then copies nothing at all.
 */
function codeBox(options: {
  attribute: string;
  copyLabel: string;
  label?: string;
  text: string;
}): string {
  const head = options.label === undefined ? "" : `<code>${escapeHtml(options.label)}</code>`;
  return `<div class="codebox">
<div class="codehead${options.label === undefined ? " end" : ""}">${head}<button type="button" class="btn" data-copy-node="[${options.attribute}]" aria-label="${escapeHtml(options.copyLabel)}">${COPY_ICON}Copy</button></div>
<pre ${options.attribute}>${escapeHtml(options.text)}</pre>
</div>`;
}

/**
 * The Browser card's five steps: a real ordered list — one column, numbered — never the
 * doctor's grid. Each step's sentence comes first (with its own `✓ done` when this machine
 * can tell), then the address or command it needs, in a code box of its own.
 *
 * As a grid the steps read left, right, left, right, they carry no numbers, and the narrow
 * column squeezes the last one ("Save it.", "✓ done") into a sliver.
 */
function guideSteps(guide: BrowserGuide): string {
  return `<ol class="guide">${guide.steps
    .map((step, index) => {
      const done = step.done === true ? ' <span class="ok">✓ done</span>' : "";
      const box =
        step.detail === undefined
          ? ""
          : codeBox({
              attribute: `data-guide-${index + 1}`,
              copyLabel: `Copy step ${index + 1}'s command or address`,
              text: step.detail,
            });
      return `<li><span class="wrap-any">${escapeHtml(step.text)}${done}</span>${box}</li>`;
    })
    .join("")}</ol>`;
}

function projectForm(
  data: ProjectCardData,
  answers: ProjectInitAnswers,
  plan: ProjectInitPlan,
): string {
  const setup = answers.setup === null ? "" : answers.setup.join(" ");
  const baseHelp = `The folder that stays on the latest ${answers.base} is never edited or committed in.`;
  // What the settings file changes: the lines the engine adds, and the ones an engine of the
  // project's own takes back out (a `-` line, the way a diff reads).
  const settingsLines = [...plan.hookLines, ...plan.removedLines.map((line) => `- ${line}`)];
  const settingsNote = settingsLineNote(plan.hookLines.length, plan.removedLines.length);
  // The hash of the two files the plan was made against: the write sends it back, and the
  // server refuses a write whose preview no longer matches the files on disk.
  const hash = data.filesHash === null ? "" : ` data-files-hash="${escapeHtml(data.filesHash)}"`;
  return `<div class="col g8" data-project-form${data.set ? "" : " hidden"}${hash}>

<div class="fields">
<div class="field"><label for="f-base">Base branch</label><input id="f-base" type="text" value="${escapeHtml(answers.base)}" data-answer="base"></div>
<div class="field"><label for="f-prefix">Worktree folder prefix</label><input id="f-prefix" type="text" value="${escapeHtml(answers.prefix)}" data-answer="prefix"></div>
<div class="field"><label for="f-setup">Setup command</label><input id="f-setup" type="text" value="${escapeHtml(setup)}" data-answer="setup"></div>
</div>

<div class="col g8">
<h3>Branches that start from another base</h3>
<p class="small muted">A branch whose name starts with the first box starts from the second one instead of the base branch.</p>
<div class="col g8" data-bases>${Object.entries(answers.bases)
    .map(([prefix, base]) => baseRow(prefix, base))
    .join("")}</div>
<div class="row"><button type="button" class="btn dashed" data-add-base>+ add</button></div>
<template data-base-template>${baseRow("", "")}</template>
</div>

<div class="col g8">
<h3>Protected branches</h3>
<div class="row" data-protected>${answers.protectedBranches
    .map(protectedChip)
    .join("")}<button type="button" class="btn dashed" data-add-protected>+ add</button></div>
<template data-chip-template>${protectedChip("")}</template>
<p class="small muted">The git guard still asks you before a push or a force push to any of these.</p>
</div>

<div class="col g8">
<h3>Guards</h3>
<div class="card list">
${guardRow({ help: baseHelp, id: "g-main", label: "Refuse edits in the main folder", name: "guardMainFolder", on: answers.guards.guardMainFolder })}
${guardRow({ help: "Every session is named after the branch it works on.", id: "g-name", label: "Name each session", name: "sessionNames", on: answers.guards.sessionNames })}
${guardRow({ help: "The type check, the build, the tests and the coverage run here go through the queue.", id: "g-jobs", label: "Heavy jobs through the queue", name: "jobRoute", on: answers.guards.jobRoute })}
</div>
</div>

<div class="col g8">
<h3>Worktree engine</h3>
<p class="small muted">The plugin's engine makes the worktree and runs the setup command. The project's own runs your script instead.</p>
<div role="group" aria-label="Worktree engine" class="segment" data-engine>
<button type="button" aria-pressed="${answers.engine === "plugin"}" data-engine-value="plugin">The plugin's</button>
<button type="button" aria-pressed="${answers.engine === "own"}" data-engine-value="own">The project's own</button>
</div>
</div>

<div class="col g8">
<h3>Preview</h3>
<p class="small muted">Exactly what will be written.</p>
${codeBox({ attribute: "data-preview-file", copyLabel: "Copy the contents of .claude/cc-smart-dev-kit.json", label: ".claude/cc-smart-dev-kit.json", text: plan.text })}
${codeBox({ attribute: "data-preview-settings", copyLabel: "Copy the lines .claude/settings.json changes by", label: ".claude/settings.json", text: settingsLines.join("\n") })}
<p class="small muted" data-preview-note>${escapeHtml(settingsNote)}</p>
<div class="col g2" data-preview-notes>${plan.notes
    .map((note) => `<p class="small muted">${escapeHtml(note)}</p>`)
    .join("")}</div>
</div>

<div class="row">
<button type="button" class="btn strong" data-write data-confirm="Write these two files into the repo? Nothing is committed: the change is yours to review and commit.">Write the files</button>
<button type="button" class="btn" data-cancel>Cancel</button>
</div>
<div data-out-for="project.write" role="status"></div>

<p>This writes two files in the repo. Commit them like any change: the team shares one setup.</p>
</div>`;
}

/**
 * The Project card on Machine: the repo the portal was started in. Two states, the design's
 * own — nothing set up yet (the line, and the button), and the form itself. A project that
 * cannot be read (no git, a file that will not parse) is one line in words, and no form.
 * Nothing here is invented: the values are the project's own file, or the same defaults
 * `cc-smart-dev-kit project init` would offer, and the preview is the same pure plan the
 * write makes (the browser never builds the file).
 */
export function projectCard(data: ProjectCardData): string {
  if (data.root === null) {
    return `<section class="card pad" id="project">
<div class="spread"><h2>Project</h2><span class="warnmark">cannot be read</span></div>
<div class="notice">The project cannot be read: <span class="mono wrap-any">${escapeHtml(data.error ?? "there is no project here")}</span>.</div>
<p class="muted">Machine, doctor and the Settings page still work. A project is set up in its own folder, in a terminal: <code>${COMMAND} project init</code>.</p>
</section>`;
  }
  const name = data.name ?? "";
  const head = `<div class="spread">
<h2>Project</h2>
${data.set ? `<span class="mono small muted">${escapeHtml(name)}</span>` : '<span class="muted bold">not set up</span>'}
</div>`;
  const stateA = data.set
    ? ""
    : `<p>Project: <span class="mono bold">${escapeHtml(name)}</span> <span class="muted">(the repo the portal was started in)</span></p>
<p class="muted">No <code>.claude/cc-smart-dev-kit.json</code>: the project's guards and worktree hooks are off here.</p>
<div class="row"><button type="button" class="btn strong" data-setup-show><span aria-hidden="true">+</span>Set up this project</button></div>`;
  const answers = data.answers;
  const plan = data.plan;
  const form =
    answers === null || plan === null
      ? `<div class="notice">The plan cannot be built: <span class="mono wrap-any">${escapeHtml(data.planError ?? "no answers")}</span>.</div>`
      : projectForm(data, answers, plan);
  return `<section class="card pad" id="project" data-project>
${head}
${stateA}
${form}
</section>`;
}

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

/**
 * One check line, as the Doctor card and the Browser card both draw it: the mark, then the words.
 * Nothing here is invented; the words are `doctor`'s own (`checkLine` prints the same ones).
 */
function checkItem(check: DoctorCheck): string {
  return `<li class="${check.ok ? "" : "fail"}"><span class="mark ${check.ok ? "ok" : "badmark"}" aria-hidden="true">${check.warn === true ? "!" : check.info === true ? "·" : check.ok ? "✓" : "✗"}</span><span class="wrap-any">${escapeHtml(check.text)}</span></li>`;
}

/**
 * The Browser card on Machine: doctor's browser lines, the steps a person follows, a button that
 * runs `browser setup` (it opens the Web Store page in the `claude-code` profile, and names that
 * profile in `Local State` while Chrome is closed), and the token field. **The stored token is
 * never on the page**: the field starts empty, a save answers "the token is set", and no answer
 * ever echoes the value.
 */
function browserCard(
  data: BrowserCardData,
  checks: DoctorCheck[],
  platform: NodeJS.Platform,
): string {
  const state = data.state;
  const ready = state.extensionInstalled && state.fileUrls === true && state.tokenSet;
  const lines =
    checks.length === 0
      ? '<p class="muted">Open this page again to see the checks.</p>'
      : `<ul class="checks">${checks.map(checkItem).join("")}</ul>`;
  const notes = [...data.guide.notes, ...data.notes.map((note) => note.replace(/^!\s*/, ""))];
  return `<section class="card pad" id="browser">
<div class="spread">
<div>
<h2>Browser</h2>
<p class="small muted">The Playwright MCP server drives YOUR Chrome, through the Playwright extension, in a profile of its own named <span class="mono">${escapeHtml(state.profileDirName)}</span>. ${ready ? "It is set up." : "It is NOT ready yet."} The same lines as <code>${COMMAND} doctor</code>.</p>
</div>
<button type="button" class="btn primary" data-action="browser.setup" data-confirm="Open the Playwright extension's page in the ${escapeHtml(state.profileDirName)} Chrome profile? The same command as ${COMMAND} browser setup runs: Chrome comes to the front, nothing is installed without your click, and the profile is named in Chrome's own settings file while Chrome is closed." data-reload>Set up the browser</button>
</div>
<div data-out-for="browser.setup" role="status"></div>
${lines}
<p class="small muted">${escapeHtml(data.guide.intro)}</p>
${guideSteps(data.guide)}
${notes.map((note) => `<p class="small muted wrap-any">${escapeHtml(note)}</p>`).join("")}
<div class="fields">
<div class="field">
<label for="browser-token">The extension's token</label>
<input id="browser-token" type="password" autocomplete="off" data-token-input placeholder="${state.tokenSet ? "a token is set — paste a new one to replace it" : "paste PLAYWRIGHT_MCP_EXTENSION_TOKEN=…"}">
</div>
</div>
<div class="row">
<button type="button" class="btn strong" data-token-save>Save the token</button>
</div>
<p class="small muted">It is written to the same file <code>${COMMAND} browser token</code> writes, ${tokenFileWords(platform)}, and it is never shown again, printed, or logged anywhere. Without it the extension would ask you to approve every connection, so the plugin refuses to start.</p>
<div data-out-for="browser.token" role="status"></div>
</section>`;
}

/**
 * How the token file is protected, in the only words that are true on this machine. The mode
 * is a POSIX idea: Windows has no `chmod`, and what keeps the file to one person there is the
 * ACL of the user profile it sits in.
 */
function tokenFileWords(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "in your own user profile, where only you can read it"
    : "mode 600: readable only by you";
}

export function machinePage(shell: Shell, data: MachineData): string {
  const omniroute = data.omniroute;
  const install = omniroute.install;
  const previous = omniroute.previous;
  // The config's own name for the affordable backend; without a gateway config, neither.
  const backendLine =
    omniroute.backend ??
    (shell.facts.router === null ? "the gateway is not set up" : "(none in the config)");
  const omnirouteCard = `<section class="card pad">
<div class="spread"><h2>OmniRoute</h2><code class="small">${COMMAND} omniroute status</code></div>
${
  install === null
    ? `<p class="muted">Not installed here, so the affordable slots have no backend. Install it in your own terminal, then run <code>${COMMAND} gateway setup</code>:</p>${command(`bun add -g ${"omniroute"}`, "Copy the install command")}`
    : `<div class="kv">
<div class="item"><span class="label">Installed</span><span class="value mono">${escapeHtml(install.version)}</span></div>
<div class="item"><span class="label">Newest, 3 days old</span><span class="value mono">${omniroute.newestVersion === null ? "(not read)" : `${escapeHtml(omniroute.newestVersion)}${omniroute.state === "ok" ? ' <span class="ok">✓</span>' : ""}`}</span></div>
<div class="item"><span class="label">Unit</span><span class="value mono">${omniroute.unit === null ? "(none)" : escapeHtml(omniroute.unit)}</span></div>
<div class="item"><span class="label">Backend</span><span class="value mono small">${escapeHtml(backendLine)}</span></div>
</div>
${omniroute.registryError === null ? "" : `<p class="notice">The npm registry could not be read: ${escapeHtml(omniroute.registryError)}</p>`}
${
  omniroute.unit === null
    ? `<p class="notice">No user unit runs OmniRoute here, so an update installs the new version but cannot restart it or check it: restart OmniRoute the way this machine runs it, then run <code>${COMMAND} omniroute status</code>.</p>`
    : `<p class="muted">The update restarts ${escapeHtml(omniroute.unit)}, so the gateway's slots fall to their next target while it comes back: Claude answers, on your own login. A version that does not answer is put back.</p>`
}
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
  // The browser's own lines are drawn on the Browser card above (the same words, one home): this
  // list is everything else, so no line appears twice on one page.
  const doctorChecks =
    doctor === null ? [] : doctor.checks.filter((check) => check.section !== "browser");
  const browserChecks =
    doctor === null ? [] : doctor.checks.filter((check) => check.section === "browser");
  const failed = doctorChecks.filter((check) => !check.ok).length;
  const doctorCard = `<section class="card pad">
<div class="spread">
<div>
<h2>Doctor</h2>
<p class="small muted">The same checks as <code>${COMMAND} doctor</code>, without the browser's own, which are on the Browser card above.${doctor === null ? " Not run yet." : ` Ran at ${escapeHtml(clockFrom(doctor.at))}. ${failed === 0 ? "Every check passed." : `${doctorChecks.length - failed} passed, ${failed} to fix.`}`}</p>
</div>
<button type="button" class="btn primary" data-action="doctor.run" data-reload>Run again</button>
</div>
${
  doctor === null
    ? '<p class="muted">Open this page again once it has run.</p>'
    : `<ul class="checks">${doctorChecks.map(checkItem).join("")}</ul>`
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

${projectCard(data.project)}

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
${browserCard(data.browser, browserChecks, shell.facts.platform)}
${doctorCard}
${autoMode}
${gatewayCard(shell, data.configError)}`;
  return layout({ active: "machine", body, shell, title: "Machine" });
}

/**
 * The card about the router. Without a gateway config there is none to report on: a short
 * line says so, and points at the one command that sets it up. Everything above it on this
 * page works without the gateway — which is why this page renders when the others cannot.
 */
function gatewayCard(shell: Shell, configError?: string): string {
  const router = shell.facts.router;
  if (router === null) {
    const heading =
      configError === undefined ? "The gateway is not set up" : "The gateway config cannot be read";
    const error =
      configError === undefined
        ? ""
        : `<div class="notice">Nothing that needs it works until it is fixed: <span class="mono wrap-any">${escapeHtml(configError)}</span>. Fix it by hand, or set the gateway up again in a terminal.</div>`;
    return `<section class="card pad">
<h2>${heading}</h2>
${error}
<p class="muted">Overview, Slots and Health need the gateway. Everything on this page works without it. Set it up in a terminal, then reload:</p>
${command(`${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`, "Copy the setup command")}
</section>`;
  }
  if (router.up) return "";
  return `<section class="card bad">
<h2 class="badmark">✗ The router is not answering</h2>
<p class="muted">The gateway is set up, but nothing answers on 127.0.0.1:${router.port}. See the Health page for the log and the restart.</p>
<a class="btn" href="/health">Open Health</a>
</section>`;
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
export function privacyPage(shell: Shell): string {
  const port = shell.facts.portalPort;
  const router = shell.facts.router;
  // Nothing to name when the gateway was never set up: the page says so instead of a port.
  const routerLine =
    router === null
      ? ", and no router answers here (the gateway is not set up)"
      : `, and the router on <span class="mono">127.0.0.1:${router.port}</span>`;
  const body = `<div class="pagehead">
<div>
<h1>How the portal stays private</h1>
<p>This run listens on <span class="mono">127.0.0.1:${port}</span>${routerLine}.</p>
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
    text: 'The portal changes the session\'s own model path and the safety judge. Claude must never do that for itself, and you should never open the portal in the Chrome profile Claude drives (its own, <span class="mono">claude-code</span>): Claude could then reach its buttons.',
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
