/**
 * The live side of plan hand-outs (D5, D6, D7). The store knows only what its rows say
 * (`classifyLeadPlans`); this file adds what only git, gh and hc can say, so it runs from
 * `herdr start --plan` and `herdr plans`, never from a hook or the status line:
 *
 * - whether a closed blocker's pull request merged (`pullRequestState`), or, with no pull request,
 *   whether its branch reached the default branch;
 * - each held plan's branch diff, read before any write lock, for overlaps and drift;
 * - the pane of a child (hc).
 *
 * Every refusal and every line says what is wrong and how to fix it.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import type { Out } from "../cli/ui/out";
import { runGit, runGitRaw } from "../hooks/git";
import type { Env } from "../hooks/run";
import { locateCheckout } from "../project/resolve";
import { taskContext } from "../tasks/context";
import { planFilesCheck } from "../tasks/files-check";
import { openWorkDb, type WorkDb, workDbFile } from "../tasks/work/db";
import { CLAIM_PROCESS, callerOf } from "../tasks/work/identity";
import { classifyLeadPlans, type LeadPlan, type LeadPlanState } from "../tasks/work/lead-plans";
import {
  allTasks,
  filesOverlap,
  type HeldPlan,
  heldPlansIn,
  isLead,
  isOpen,
  ownerOf,
  planByRef,
} from "../tasks/work/queries";
import { releasePlan, reservePlan, swapPlanAgent } from "../tasks/work/store";
import type { ClaimProcess, Who, WorkTask } from "../tasks/work/types";
import { baseBranch } from "../worktrees/command";
import { type PullRequestState, pullRequestState } from "../worktrees/scan";
import { HcError, type HcRunner, hcGet, hcList } from "./hc";
import { HERDR_AGENT_PREFIX, isHerdrAgent, KIT_PLAN, parseLeadId } from "./labels";

/** How often `herdr plans --wait` looks again: a gh call per plan with a child, so not often. */
export const PLAN_POLL_MS = 15_000;
/**
 * How long a hand-out with no child bound yet is left alone: a start reserves, then launches, then
 * binds (up to 20 s of launch polling). Older than this, a reserved plan with no agent is a start
 * that died between the two.
 */
export const HANDOUT_GRACE_MS = 120_000;
/**
 * What a start writes into a plan's `agent` while it launches the child (`swapPlanAgent`): the
 * claim that keeps a second start out of the same worktree. The child's real address replaces it.
 * Past the grace it reads as a start that died.
 */
export const PENDING_AGENT_PREFIX = "pending:";

/** Where a plan child's pane stands: `none` (no child was bound), `live`, `gone`, or `unknown` (another core, say). */
export type PaneState = "none" | "live" | "gone" | "unknown";
export interface Pane {
  state: PaneState;
  /** The child's own status (idle, working, blocked), when the pane is live. */
  status: string | null;
  address: string | null;
}
/** Reads the pane a plan's `agent` names. `slug` guards against a reused address. */
export type PaneProbe = (agent: string | null, slug: string) => Pane;

/** A pull request, as gh shows it for one branch at one head (`pullRequestState`). */
export type PrState = PullRequestState;
export type PrReader = (repo: string, branch: string, head: string, env: Env) => PrState;

/** What `herdr plans` says of one plan. Store states keep their names; the live gates add the rest. */
export type PlanState = LeadPlanState | "released" | "stale" | "blocked" | "overlaps";

export interface PlanLine {
  number: number;
  plan: string;
  subject: string;
  state: PlanState;
  /** What is true, in words. */
  text: string;
  /** What fixes it, for a line that needs the person or the lead to act. */
  fix: string | null;
  /** The plan's own branch's pull request, for a plan with a child or one that is closing. */
  pr: PrState | null;
  pane: Pane | null;
  /** Held plans whose files this plan's branch reaches (D7): `#n: path`. */
  drift: string[];
}

/** Everything a judgment reads, gathered by the caller (`command.ts`). */
export interface PlansWorld {
  db: WorkDb;
  project: string;
  who: Who;
  /** The main checkout: git runs here, and branches are shared by every worktree. */
  repo: string;
  env: Env;
  /** The default branch's name, and where it came from: `default` is a guess (`main`), never proof. */
  base: string;
  baseFrom: "config" | "origin" | "default";
  process: ClaimProcess;
  pr: PrReader;
  pane: PaneProbe;
  /** The address of a live terminal labelled `kit.plan=<slug>`, or null: a child that no plan row names. */
  labelled: (slug: string) => string | null;
  /** `plans.mergeFiles` and `core.ignorecase` (`planFilesCheck`), read before any write lock. */
  check: { ignore: readonly string[]; caseFold: boolean };
  /** The clock, read fresh each time: a store write is stamped when it happens, not when this opened. */
  now: () => number;
}

function git(world: PlansWorld, args: string[]) {
  return runGit(world.repo, args, world.env);
}

/** `origin/<base>` when the checkout knows it, else the local default branch; null when neither exists. */
function baseRef(world: PlansWorld): string | null {
  for (const ref of [`refs/remotes/origin/${world.base}`, `refs/heads/${world.base}`])
    if (git(world, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok)
      return ref.replace(/^refs\/(remotes|heads)\//, "");
  return null;
}

/** The commit a recorded branch is at, here or on origin; null when the branch is unknown. */
function tipOf(world: PlansWorld, branch: string): string | null {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const run = git(world, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (run.ok && run.out !== "") return run.out;
  }
  return null;
}

/**
 * The files a plan's branch changed since it left the default branch, both sides of a rename
 * (`--no-renames`). Read before the write lock. Empty when the branch or the base is unknown:
 * the stored list still holds the plan's files.
 */
function branchDiff(world: PlansWorld, plan: WorkTask): string[] {
  if (plan.branch === null) return [];
  const tip = tipOf(world, plan.branch);
  const base = baseRef(world);
  if (tip === null || base === null) return [];
  const run = runGitRaw(
    world.repo,
    ["diff", "--name-only", "--no-renames", "-z", `${base}...${tip}`],
    world.env,
  );
  return run.ok ? run.out.split("\0").filter((line) => line !== "") : [];
}

const label = (plan: WorkTask) => `#${plan.number} ${plan.plan ?? plan.subject}`;

type Blocker =
  | { clear: true }
  | { clear: false; kind: "waiting" | "blocked"; text: string; fix: string | null };
const CLEAR: Blocker = { clear: true };

/** Why a branch is not proved on the default branch: still on its way (`waiting`), or needs a person (`blocked`). */
type Proof =
  | { proved: true }
  | { proved: false; kind: "waiting" | "blocked"; text: string; fix: string | null };

/**
 * The proof of a merge when gh has no pull request to show (`none`) or cannot answer (`unknown`):
 * the branch holds commits past its recorded start, and its tip is on the default branch. An empty
 * branch is trivially an ancestor, so it proves nothing, and with no start recorded nothing can
 * be proved. One home for a blocker (D5) and for a finished plan waiting to be released.
 */
function onDefaultBranch(
  world: PlansWorld,
  plan: WorkTask,
  tip: string,
  gh: "none" | "unknown",
): Proof {
  const name = label(plan);
  const asked = gh === "unknown" ? "gh cannot say whether it merged" : "no pull request was found";
  if (plan.base === null)
    return {
      proved: false,
      kind: "blocked",
      text: `${name}: ${asked}, and no start commit is recorded, so a merge cannot be proved`,
      fix: `log in to gh, or record where it started: task_update #${plan.number} with base`,
    };
  const past = git(world, ["rev-list", "--count", `${plan.base}..${tip}`]);
  if (!past.ok)
    return {
      proved: false,
      kind: "blocked",
      text: `${name}: git cannot compare its branch with its recorded start`,
      fix: `check it with task_update #${plan.number} base`,
    };
  if (Number(past.out) === 0)
    return {
      proved: false,
      kind: "blocked",
      text: `${name}: its branch holds no commit past its start`,
      fix: `an empty branch proves nothing: merge its work first`,
    };
  const base = baseRef(world);
  const onBase = base === null ? null : git(world, ["merge-base", "--is-ancestor", tip, base]);
  if (onBase?.code === 0) return { proved: true };
  return {
    proved: false,
    kind: "waiting",
    text: `${name} (${asked}; its branch is not on ${base ?? world.base} yet)`,
    fix: null,
  };
}

/**
 * One blocker, judged beyond the store (D5). A dropped blocker is clear, as `isBlocked` has it;
 * so is a closed blocker that is a task or a phase. A closed plan is clear when its pull request
 * merged at its head, or, with no pull request, when its branch is proved on the default branch
 * (`onDefaultBranch`). Anything unknown is never clear.
 */
function judgeBlocker(world: PlansWorld, blocker: WorkTask): Blocker {
  if (blocker.status === "dropped") return CLEAR;
  const name = label(blocker);
  if (isOpen(blocker))
    return { clear: false, kind: "waiting", text: `${name} is still open`, fix: null };
  if (blocker.kind !== "plan") return CLEAR;
  if (blocker.branch === null)
    return {
      clear: false,
      kind: "blocked",
      text: `blocker ${name} has no branch recorded`,
      fix: `task_update #${blocker.number} with branch set to the branch of its pull request`,
    };
  const tip = tipOf(world, blocker.branch);
  if (tip === null)
    return {
      clear: false,
      kind: "blocked",
      text: `blocker ${name}: branch ${blocker.branch} is not in this repository`,
      fix: `fetch it, or correct it with task_update #${blocker.number} branch`,
    };
  const pr = world.pr(world.repo, blocker.branch, tip, world.env);
  if (pr === "merged") return CLEAR;
  if (pr === "closed")
    return {
      clear: false,
      kind: "blocked",
      text: `blocker ${name}: its pull request was closed without merging`,
      fix: `the person decides: reopen it, or lift the block with task_update blocked_by_remove`,
    };
  if (pr === "open")
    return { clear: false, kind: "waiting", text: `${name} (its pull request is open)`, fix: null };
  const proof = onDefaultBranch(world, blocker, tip, pr);
  if (proof.proved) return CLEAR;
  return {
    clear: false,
    kind: proof.kind,
    text: proof.kind === "blocked" ? `blocker ${proof.text}` : proof.text,
    fix: proof.fix,
  };
}

function paneWords(pane: Pane | null): string {
  if (pane === null || pane.state === "none") return "no child bound";
  if (pane.state === "live" && pane.address === null) return "a child is starting";
  if (pane.state === "live")
    return `pane ${pane.address} live${pane.status ? `, ${pane.status}` : ""}`;
  if (pane.state === "gone") return `pane ${pane.address ?? ""} gone`.replace("  ", " ");
  return `pane ${pane.address ?? ""} cannot be read from this core`.replace("  ", " ");
}

/**
 * The pane of a plan's child. A start that claimed the plan and is still launching
 * (`PENDING_AGENT_PREFIX`) reads as a live child; past the grace it died, and reads as gone.
 */
function paneOf(world: PlansWorld, plan: WorkTask): Pane {
  if (plan.agent?.startsWith(PENDING_AGENT_PREFIX))
    return world.now() - plan.updatedAt <= HANDOUT_GRACE_MS
      ? { state: "live", status: "starting", address: null }
      : { state: "gone", status: null, address: null };
  return world.pane(plan.agent, plan.plan ?? plan.subject);
}

/** The resume command a line suggests: the person fills in the model, effort, mode and brief. */
function startWords(slug: string): string {
  return `${COMMAND} herdr start --plan ${slug} --model <model> --effort <effort> --mode <mode> -- "<brief>"`;
}

export interface Judgment {
  lines: PlanLine[];
  /** Each held plan's branch diff by its plan task id: what `reservePlan` is given. */
  extraFiles: Record<string, string[]>;
}

/** The line a plan starts from: its identity, and no live facts yet. */
function baseLine(plan: WorkTask) {
  return {
    number: plan.number,
    plan: plan.plan ?? plan.subject,
    subject: plan.subject,
    pr: null,
    pane: null,
    drift: [] as string[],
  };
}
type BaseLine = ReturnType<typeof baseLine>;

function lineOf(
  base: BaseLine,
  state: PlanState,
  text: string,
  fix: string | null = null,
  more: Partial<PlanLine> = {},
): PlanLine {
  return { ...base, state, text, fix, ...more };
}

/**
 * What the lead's bookkeeping owes, done first so every reading after it sees the files free:
 * - a closed plan whose pull request merged or closed releases its reservation; so does one with
 *   no pull request (or none gh can show) whose branch is proved on the default branch
 *   (`onDefaultBranch`);
 * - a hand-out that never started and has nothing to relaunch into, when no live terminal carries
 *   its label.
 * A release guards the hand-out id it read, so a plan handed out again meanwhile is left alone.
 * Returns the lines of what it released; a release the store refuses is left for the reading.
 */
function settle(world: PlansWorld, owns: (task: WorkTask) => boolean): PlanLine[] {
  const released: PlanLine[] = [];
  for (const entry of classifyLeadPlans(world.db, world.project, world.who, world.process)) {
    const plan = entry.plan;
    if (plan.lead === null) continue;
    const base = baseLine(plan);
    let reason: string | null = null;
    let text = "";
    let pr: PrState | null = null;
    if (entry.state === "merging") {
      pr = prOf(world, plan);
      if (pr === "merged" || pr === "closed") {
        reason = `pull request ${pr}`;
        text = `finished: its pull request ${pr}, so its files are free`;
      } else if (pr === "none" || pr === "unknown") {
        const tip = plan.branch === null ? null : tipOf(world, plan.branch);
        if (tip !== null && onDefaultBranch(world, plan, tip, pr).proved) {
          const onto = baseRef(world) ?? world.base;
          reason = `its branch is on ${onto}`;
          text = `finished: its branch is on ${onto}, so its files are free`;
        }
      }
    } else if (entry.state === "with-child") {
      if (
        staleHandout(world, plan, paneOf(world, plan), owns) === "release" &&
        world.labelled(base.plan) === null
      ) {
        reason = "hand-out never started";
        text = "a hand-out that never started: its reservation is released";
      }
    }
    if (reason === null) continue;
    const done = releasePlan(world.db, {
      project: world.project,
      plan: base.plan,
      who: world.who,
      now: world.now(),
      reason,
      handoutId: plan.lead.handoutId,
      updatedAt: plan.updatedAt,
    });
    if (done.ok) released.push(lineOf(base, "released", text, null, { pr }));
  }
  return released;
}

/**
 * Where each of the caller's plans stands, with the live gates: the store's classifier first
 * (`classifyLeadPlans`), then the pane, the pull request, the branch diffs. `only` judges the live
 * gates of one plan (a start); reserved plans are always read, since they hold files. Settling
 * runs first (`settle`), so a plan whose pull request just merged no longer holds its files.
 */
export function judgePlans(input: PlansWorld, only?: string): Judgment {
  const answers = new Map<string, PrState>();
  const world: PlansWorld = {
    ...input,
    pr: (repo, branch, head, env) => {
      const key = `${branch}@${head}`;
      const known = answers.get(key);
      if (known !== undefined) return known;
      const answer = input.pr(repo, branch, head, env);
      answers.set(key, answer);
      return answer;
    },
  };
  const owns = ownerOf(world.who);
  const released = settle(world, owns);
  const all = allTasks(world.db, world.project);
  const byId = new Map(all.map((t) => [t.id, t]));
  const stored = classifyLeadPlans(world.db, world.project, world.who, world.process);
  // The branch diffs are read first, outside any transaction: no git runs under a write lock.
  const extraFiles: Record<string, string[]> = {};
  for (const held of heldPlansIn(all, world.who))
    if (held.plan.branch !== null) extraFiles[held.plan.id] = branchDiff(world, held.plan);
  const held = heldPlansIn(all, world.who, extraFiles);
  const lines: PlanLine[] = [...released];
  for (const entry of stored) {
    const plan = entry.plan;
    const base = baseLine(plan);
    const slug = base.plan;
    const drift = driftOf(world, held, extraFiles, plan);
    switch (entry.state) {
      case "own":
        lines.push(
          lineOf(base, "own", "reserved for this session itself: it builds the plan", null, {
            drift,
          }),
        );
        break;
      case "merging": {
        const pr = prOf(world, plan);
        if (pr === "merged" || pr === "closed")
          lines.push(
            lineOf(
              base,
              "merging",
              `finished, and its pull request ${pr}, but the store did not release its files`,
              `run ${COMMAND} herdr plans again`,
              { pr },
            ),
          );
        else {
          const out = `the person decides: if its work is merged or given up, release its files with ${COMMAND} herdr plans --release ${slug}`;
          lines.push(
            lineOf(
              base,
              "merging",
              pr === null
                ? "finished, but no branch is recorded: its files stay held"
                : pr === "open"
                  ? "finished: its files stay held until its pull request merges or closes (open)"
                  : pr === "unknown"
                    ? `finished: gh cannot say whether its pull request merged, and its branch is not proved on ${baseRef(world) ?? world.base}: its files stay held`
                    : `finished: no pull request was found, and its branch is not proved on ${baseRef(world) ?? world.base}: its files stay held`,
              pr === null
                ? `task_update #${plan.number} with branch, so its pull request can be found; or ${out}`
                : pr === "open"
                  ? null
                  : out,
              { pr },
            ),
          );
        }
        break;
      }
      case "with-child":
      case "child-gone": {
        const pane = paneOf(world, plan);
        const handout = entry.state === "with-child" ? staleHandout(world, plan, pane, owns) : null;
        if (handout === "relaunch") {
          lines.push(
            lineOf(
              base,
              "stale",
              "its child never took the plan and its pane is gone",
              `relaunch it in its own worktree: ${startWords(slug)}`,
              { pane },
            ),
          );
          break;
        }
        if (handout === "release") {
          const stray = world.labelled(slug);
          lines.push(
            lineOf(
              base,
              "stale",
              stray === null
                ? "a hand-out that never started, but the store did not release it"
                : `no pane is bound, but terminal ${stray} carries its label, so it is not released`,
              stray === null
                ? `run ${COMMAND} herdr plans again`
                : `if ${stray} is its child, leave it; if not: ${COMMAND} herdr stop ${stray}`,
              { pane },
            ),
          );
          break;
        }
        const pr = prOf(world, plan);
        const driftText = drift.length ? `; drift: its branch reaches ${drift.join("; ")}` : "";
        if (entry.state === "with-child")
          lines.push(
            lineOf(
              base,
              "with-child",
              `with a child (${paneWords(pane)}${pr === "open" ? "; pull request open" : pr === "merged" ? "; pull request merged" : ""})${driftText}`,
              null,
              { pr, pane, drift },
            ),
          );
        else if (pane.state === "gone" || pane.state === "none")
          lines.push(
            lineOf(
              base,
              "child-gone",
              `its child is gone (${paneWords(pane)})${driftText}`,
              `resume it in its own worktree: ${startWords(slug)}`,
              { pr, pane, drift },
            ),
          );
        else
          lines.push(
            lineOf(
              base,
              "child-gone",
              `its child's session ended, but ${paneWords(pane)}`,
              `close that pane first: ${COMMAND} herdr stop ${pane.address ?? "<terminal>"}`,
              { pr, pane, drift },
            ),
          );
        break;
      }
      case "no-files":
      case "waiting":
      case "ready": {
        if (only !== undefined && only !== slug) {
          lines.push(lineOf(base, entry.state, "not judged: another plan is being started"));
          break;
        }
        lines.push(readiness(world, entry, held, byId, base));
        break;
      }
    }
  }
  lines.sort((a, b) => a.number - b.number);
  return { lines, extraFiles };
}

/** The pull request of a plan's own branch; null when no branch is recorded or it is not here. */
function prOf(world: PlansWorld, plan: WorkTask): PrState | null {
  if (plan.branch === null) return null;
  const tip = tipOf(world, plan.branch);
  return tip === null ? null : world.pr(world.repo, plan.branch, tip, world.env);
}

/**
 * Held plans whose files this plan's own branch reaches (D7 drift): what a builder changed
 * outside its declared list. `mergeFiles` take no part, as in every overlap.
 */
function driftOf(
  world: PlansWorld,
  held: readonly HeldPlan[],
  extraFiles: Readonly<Record<string, readonly string[]>>,
  plan: WorkTask,
): string[] {
  // A changed path inside the plan's own list (a file of a declared folder) is no drift.
  const diff = (extraFiles[plan.id] ?? []).filter(
    (path) => filesOverlap(plan.files, [path], { caseFold: world.check.caseFold }).length === 0,
  );
  if (diff.length === 0) return [];
  const found: string[] = [];
  for (const other of held) {
    if (other.plan.id === plan.id) continue;
    const touched = filesOverlap(diff, other.files, world.check);
    if (touched.length)
      found.push(`${label(other.plan)}: ${[...new Set(touched.map((t) => t.path))].join(", ")}`);
  }
  return found;
}

type Handout = "relaunch" | "release";

/**
 * A hand-out the lead still owns (its child never took the plan) whose child is not there: its
 * launch bound a pane that is gone, or it never bound one and the grace is over. With a recorded
 * worktree a child ran there once, so the start relaunches into it; with none, nothing exists to
 * reuse and the reservation is released.
 */
function staleHandout(
  world: PlansWorld,
  plan: WorkTask,
  pane: Pane,
  owns: (task: WorkTask) => boolean,
): Handout | null {
  if (plan.lead === null || plan.lead.holder !== "child" || !owns(plan)) return null;
  const stale =
    plan.agent === null ? world.now() - plan.updatedAt > HANDOUT_GRACE_MS : pane.state === "gone";
  if (!stale) return null;
  return plan.worktree === null ? "release" : "relaunch";
}

/** A plan nothing holds: its store state, then the live gates (D5), then the overlaps. */
function readiness(
  world: PlansWorld,
  entry: LeadPlan,
  held: readonly HeldPlan[],
  byId: ReadonlyMap<string, WorkTask>,
  base: Pick<PlanLine, "number" | "plan" | "subject" | "pr" | "pane" | "drift">,
): PlanLine {
  const plan = entry.plan;
  const line = (state: PlanState, text: string, fix: string | null = null): PlanLine => ({
    ...base,
    state,
    text,
    fix,
  });
  if (entry.state === "waiting")
    return line("waiting", `waiting on ${entry.waitingOn.map(label).join(", ")}`);
  if (entry.state === "no-files")
    return line(
      "no-files",
      "has no file list, so it is never handed out",
      `task_update #${plan.number} with files: the paths and folders it changes`,
    );
  const waiting: string[] = [];
  for (const id of plan.waitsFor) {
    const blocker = byId.get(id);
    if (blocker === undefined) continue;
    const verdict = judgeBlocker(world, blocker);
    if (verdict.clear) continue;
    if (verdict.kind === "blocked") return line("blocked", `blocked: ${verdict.text}`, verdict.fix);
    waiting.push(verdict.text);
  }
  if (waiting.length) return line("waiting", `waiting on ${waiting.join(", ")}`);
  // Unknown is never clear (D5): a held plan with no list and no branch diff shares nothing a check can find.
  const unlisted = held.filter((other) => other.plan.id !== plan.id && other.files.length === 0);
  if (unlisted.length > 0)
    return line(
      "blocked",
      `blocked: ${unlisted.map((other) => label(other.plan)).join(", ")} ${unlisted.length > 1 ? "are" : "is"} held with no file list and no branch diff, so no overlap can be ruled out`,
      unlisted
        .map(
          (other) =>
            `task_update #${other.plan.number} with files: the paths and folders it changes, or finish, park or drop it`,
        )
        .join("; "),
    );
  const clashes: string[] = [];
  for (const other of held) {
    if (other.plan.id === plan.id) continue;
    const touched = filesOverlap(plan.files, other.files, world.check);
    if (touched.length === 0) continue;
    const files = [...new Set(touched.map((t) => t.path))].join(", ");
    const closed = isOpen(other.plan) ? "" : " (finished: held until its pull request settles)";
    clashes.push(`${label(other.plan)}${closed}: ${files}`);
  }
  if (clashes.length) return line("overlaps", `overlaps ${clashes.join("; ")}`);
  return line("ready", "ready: nothing blocks it and no held plan shares its files");
}

/** The `plans` summary line's words for each count. */
function summary(lines: readonly PlanLine[]): string {
  const count = (state: PlanState) => lines.filter((line) => line.state === state).length;
  const parts = [
    [count("with-child"), "with children"],
    [count("own"), "built here"],
    [count("child-gone"), "child gone"],
    [count("merging"), "closing"],
    [count("waiting") + count("overlaps"), "waiting"],
    [count("blocked") + count("no-files") + count("stale"), "need you"],
    [count("ready"), "ready"],
  ] as const;
  const shown = parts.filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`);
  return shown.length ? shown.join(" · ") : "nothing to hand out";
}

/** The outcome of getting a plan ready for a child to start on. */
export type PlanStart =
  | { ok: false; why: string; fix?: string }
  | {
      ok: true;
      plan: WorkTask;
      /** The hand-out id: the child's take names it as `from`. */
      handoutId: string;
      /** This call reserved the plan: a failed launch gives it back. */
      reserved: boolean;
      /** The child continues a worktree that holds its work: no fetch, no reset. */
      resume: boolean;
      /** The worktree and branch a child already ran in; null for a first start. */
      recorded: { worktree: string; branch: string } | null;
      /**
       * A resume or a relaunch claims the plan's agent before it launches (`swapPlanAgent`): the
       * marker it wrote, and the agent it replaced, which a failed launch puts back. Null for a
       * first start, where the reservation is the claim.
       */
      claim: { marker: string; previous: string | null } | null;
    };

type Refusal = Extract<PlanStart, { ok: false }>;
const refuse = (why: string, fix?: string): Refusal =>
  fix === undefined ? { ok: false, why } : { ok: false, why, fix };

/**
 * The refusal for a start whose child would reset to the default branch while that branch is only
 * a guess (`baseBranch` said `default`). One home: a plan hand-out and a follow-up child both read it.
 */
export const UNKNOWN_BASE = {
  why: "The default branch cannot be found: origin/HEAD is not set and no worktrees.base is configured, so a child would reset to a guess.",
  fix: "run `git remote set-head origin --auto`, or set worktrees.base in .claude/cc-smart-dev-kit.json",
} as const;

/** The plan a ref names, after the checks every plan command shares: a session, a real default branch, a plan. */
type Located = { ok: true; plan: WorkTask; slug: string } | Refusal;

function locatePlan(world: PlansWorld, ref: string): Located {
  if (!world.who.sessionId) return refuse("A plan hand-out needs a resolvable calling session.");
  // `main` is a guess when nothing says otherwise: a child built and reset from the wrong branch.
  if (world.baseFrom === "default") return refuse(UNKNOWN_BASE.why, UNKNOWN_BASE.fix);
  const plan = planByRef(world.db, world.project, ref);
  if (plan === null) return refuse(`Plan "${ref}" was not found in this project.`);
  if (plan.kind !== "plan")
    return refuse(`#${plan.number} is a ${plan.kind}, not a plan.`, "name the plan's slug");
  return { ok: true, plan, slug: plan.plan ?? plan.subject };
}

/**
 * A plan nothing holds: the live gates (D5), the held plans' diffs (D7), then `reservePlan`'s one
 * transaction, for `holder`: a child (`start --plan`) or the lead itself (`plans --reserve`).
 * Both read the same gates, so a plan is ready or not the same way for either.
 */
function reserveReady(
  world: PlansWorld,
  plan: WorkTask,
  slug: string,
  holder: "self" | "child",
): PlanStart {
  const strayChild = world.labelled(slug);
  if (strayChild !== null)
    return refuse(
      `Plan "${slug}": terminal ${strayChild} carries its label and is live.`,
      `if it is a child of this plan, leave it; if not: ${COMMAND} herdr stop ${strayChild}`,
    );
  const judged = judgePlans(world, slug);
  const line = judged.lines.find((one) => one.number === plan.number);
  if (line === undefined || line.state !== "ready")
    return refuse(
      `Plan "${slug}" is not ready: ${line?.text ?? "it is not a queued plan of this session"}.`,
      line?.fix ?? undefined,
    );
  const reserved = reservePlan(world.db, {
    project: world.project,
    plan: slug,
    who: world.who,
    holder,
    ignore: world.check.ignore,
    caseFold: world.check.caseFold,
    extraFiles: judged.extraFiles,
    now: world.now(),
  });
  // A refusal here is a lost race: the plan moved between the gates and the transaction.
  if (!reserved.ok) return refuse(reserved.why, `${COMMAND} herdr plans shows where it stands`);
  const lead = reserved.value.lead;
  if (lead === null)
    return refuse(`Plan "${slug}" was reserved, but the store shows no reservation.`);
  return {
    ok: true,
    plan: reserved.value,
    handoutId: lead.handoutId,
    reserved: true,
    resume: false,
    recorded: null,
    claim: null,
  };
}

/**
 * `herdr plans --reserve <plan>` (D1, D4): the lead reserves the plan it builds itself, with holder
 * `self`, so its files stay held after the plan is done, until its pull request settles. The same
 * gates and diffs as a hand-out (`reserveReady`). Refused unless the plan is a pending, unreserved
 * plan of this session: the lead then starts its first phase as usual.
 */
export function prepareReserve(world: PlansWorld, ref: string): PlanStart {
  const found = locatePlan(world, ref);
  if (!found.ok) return found;
  const { plan, slug } = found;
  const stored = classifyLeadPlans(world.db, world.project, world.who, world.process).find(
    (entry) => entry.plan.id === plan.id,
  );
  if (stored === undefined) {
    if (plan.lead !== null)
      return refuse(
        `Plan "${slug}" is reserved for another session.`,
        `${COMMAND} herdr plans lists the plans this session can reserve`,
      );
    if (!isOpen(plan))
      return refuse(
        `Plan "${slug}" is ${plan.status}: nothing to reserve.`,
        `${COMMAND} herdr plans lists the plans this session can reserve`,
      );
    // A plan this session started is held only while it runs; parking it (D4's pending) lets it be reserved.
    if (ownerOf(world.who)(plan))
      return refuse(
        `Plan "${slug}" is running: this session started it, and only a queued plan is reserved.`,
        `park it: task_update #${plan.number} with status pending once its phases stop, then run ${COMMAND} herdr plans --reserve ${slug}`,
      );
    return refuse(
      `Plan "${slug}" is not one of this session's queued plans: another session owns it.`,
      "a lead reserves only a plan it laid and has not started",
    );
  }
  if (["own", "with-child", "child-gone", "merging"].includes(stored.state))
    return refuse(
      `Plan "${slug}" is already reserved (${stored.state}).`,
      `${COMMAND} herdr plans shows where it stands`,
    );
  return reserveReady(world, plan, slug, "self");
}

/**
 * Decides how a plan starts, and reserves it (D6):
 * 1. a plan reserved for this lead whose child is gone, with its pane gone, resumes in its
 *    recorded worktree. A hand-out whose child never took the plan relaunches there.
 *    Both keep the reservation and its hand-out id.
 * 2. a plan that is ready is judged by the live gates, its held diffs are read, and then
 *    `reservePlan` takes it in one transaction. The caller launches after this and gives the
 *    plan back (`releasePlan`) if the launch fails.
 * Everything else is refused with its reason and fix.
 */
export function prepareStart(world: PlansWorld, ref: string): PlanStart {
  const found = locatePlan(world, ref);
  if (!found.ok) return found;
  const { plan, slug } = found;
  const owns = ownerOf(world.who);
  const stored = classifyLeadPlans(world.db, world.project, world.who, world.process).find(
    (entry) => entry.plan.id === plan.id,
  );
  if (stored === undefined) {
    if (plan.lead !== null)
      return refuse(
        `Plan "${slug}" is reserved for another session.`,
        "only that lead hands it out",
      );
    if (!isOpen(plan)) return refuse(`Plan "${slug}" is ${plan.status}: nothing to hand out.`);
    return refuse(
      `Plan "${slug}" is not one of this session's queued plans: another session owns it, or it is running.`,
      "a lead hands out only plans it laid and has not started",
    );
  }
  if (stored.state === "own")
    return refuse(
      `Plan "${slug}" is reserved for this session itself: it builds it, with no child.`,
    );
  if (stored.state === "merging")
    return refuse(
      `Plan "${slug}" is finished and its files stay held until its pull request settles.`,
      `${COMMAND} herdr plans releases it`,
    );
  if (stored.state === "with-child" || stored.state === "child-gone") {
    const pane = paneOf(world, plan);
    const handout = stored.state === "with-child" ? staleHandout(world, plan, pane, owns) : null;
    const gone = pane.state === "gone" || pane.state === "none";
    if (stored.state === "child-gone" && !gone)
      return refuse(
        `Plan "${slug}": its child's session ended, but ${paneWords(pane)}.`,
        `close that pane first: ${COMMAND} herdr stop ${pane.address ?? "<terminal>"}`,
      );
    if (stored.state === "with-child" && handout === null)
      return refuse(
        `Plan "${slug}" already has a child${plan.agent ? ` (${plan.agent})` : ""}: ${paneWords(pane)}.`,
        `wait for it (${COMMAND} herdr wait), or stop it: ${COMMAND} herdr stop <terminal>`,
      );
    if (plan.lead === null)
      return refuse(`Plan "${slug}" lost its reservation: run ${COMMAND} herdr plans.`);
    const recorded =
      plan.worktree !== null && plan.branch !== null
        ? { worktree: plan.worktree, branch: plan.branch }
        : null;
    if (recorded === null && stored.state === "child-gone")
      return refuse(
        `Plan "${slug}": no worktree is recorded, so the first launch's binding failed.`,
        `find its worktree (git worktree list), then task_update #${plan.number} with worktree and branch`,
      );
    // The recorded worktree is a task row, which any session may write: only the folder a child
    // starts in (`<repo>/.claude/worktrees/<name>`) is reused, never a path someone put there.
    if (recorded !== null) {
      const home = join(world.repo, ".claude", "worktrees", basename(recorded.worktree));
      if (recorded.worktree !== home)
        return refuse(
          `Plan "${slug}": its recorded worktree ${recorded.worktree} is not a child's folder (${home}).`,
          `correct it with task_update #${plan.number} worktree, or release the plan`,
        );
    }
    // A live terminal labelled for this plan is a child no row names: never start a second.
    const stray = world.labelled(slug);
    if (stray !== null)
      return refuse(
        `Plan "${slug}": terminal ${stray} carries its label and is live.`,
        `if it is the plan's child, wait for it (${COMMAND} herdr wait); if not: ${COMMAND} herdr stop ${stray}`,
      );
    // Claim the launch: if the plan moved since it was read (another start), nothing launches.
    const marker = `${PENDING_AGENT_PREFIX}${world.now()}`;
    const claimed = swapPlanAgent(world.db, {
      project: world.project,
      plan: slug,
      who: world.who,
      from: plan.agent,
      fromUpdatedAt: plan.updatedAt,
      to: marker,
      now: world.now(),
      reason: "child launching",
    });
    if (!claimed.ok)
      return refuse(
        claimed.why,
        `run ${COMMAND} herdr plans, and start again only if the plan still has no child`,
      );
    return {
      ok: true,
      plan: claimed.value,
      handoutId: plan.lead.handoutId,
      reserved: false,
      resume: stored.state === "child-gone",
      recorded,
      claim: { marker, previous: plan.agent },
    };
  }
  return reserveReady(world, plan, slug, "child");
}

/**
 * Confirms a start's claim just before it launches: the plan's agent must still be the marker
 * this start wrote (`prepareStart`). A start that stalled past the grace may have been taken for a
 * dead one, and another start claimed the plan; this refuses then, and nothing launches. A
 * success writes the marker again, so the grace runs from the launch.
 */
export function confirmClaim(
  world: PlansWorld,
  plan: string,
  claim: { marker: string },
): { ok: true } | { ok: false; why: string; fix: string } {
  const again = swapPlanAgent(world.db, {
    project: world.project,
    plan,
    who: world.who,
    from: claim.marker,
    to: claim.marker,
    now: world.now(),
    reason: "child launching",
  });
  return again.ok
    ? { ok: true }
    : {
        ok: false,
        why: `${again.why}: its claim was taken over while this start waited`,
        fix: `run ${COMMAND} herdr plans, and start again only if the plan still has no child`,
      };
}

/**
 * `herdr plans --release <plan>`: the person's way out for a finished plan whose files stay held
 * because nothing proves its work merged (no pull request, gh silent, an unproved branch). It
 * releases a closed plan this session leads and nothing else: an open plan is held by a child or
 * the lead, and only finishing or dropping it lets go.
 */
export function releaseByHand(
  world: PlansWorld,
  ref: string,
): { ok: true; text: string } | { ok: false; why: string; fix: string } {
  const plan = planByRef(world.db, world.project, ref);
  if (plan === null || plan.kind !== "plan")
    return {
      ok: false,
      why: `Plan "${ref}" was not found in this project.`,
      fix: `name a plan from ${COMMAND} herdr plans`,
    };
  const slug = plan.plan ?? plan.subject;
  if (plan.lead === null)
    return {
      ok: false,
      why: `Plan "${slug}" is not reserved: it holds no files.`,
      fix: `${COMMAND} herdr plans lists the plans this session leads`,
    };
  if (!isLead(plan.lead, world.who))
    return {
      ok: false,
      why: `Plan "${slug}" is reserved for another session.`,
      fix: "only its lead releases it",
    };
  if (isOpen(plan))
    return {
      ok: false,
      why: `Plan "${slug}" is still open: a child or this session is building it, and its files stay held.`,
      fix: "finish it (task_done) or drop it, or stop its child; then release it",
    };
  const released = releasePlan(world.db, {
    project: world.project,
    plan: slug,
    who: world.who,
    now: world.now(),
    reason: "released by hand",
    handoutId: plan.lead.handoutId,
  });
  return released.ok
    ? { ok: true, text: `Released plan #${plan.number} ${slug}: its files are free.` }
    : { ok: false, why: released.why, fix: `run ${COMMAND} herdr plans, then try again` };
}

/** The mark a line prints with: a plan the person or the lead must act on is `warn` or `fail`. */
export function markOf(state: PlanState): "fail" | "info" | "ok" | "warn" {
  switch (state) {
    case "blocked":
      return "fail";
    case "ready":
    case "released":
      return "ok";
    case "no-files":
    case "child-gone":
    case "stale":
      return "warn";
    default:
      return "info";
  }
}

/** States that can still change by themselves (a merge, a child's finish): a `--wait` has something to wait for. */
function mayChange(line: PlanLine): boolean {
  return ["with-child", "merging", "waiting", "overlaps"].includes(line.state);
}

/** What changed between two judgments of the same plans: a plan turned ready, a pull request merged, a reservation released. */
export function changesBetween(
  before: readonly PlanLine[],
  after: readonly PlanLine[],
): PlanLine[] {
  return after.filter((now) => {
    const old = before.find((one) => one.number === now.number);
    if (now.state === "released") return old?.state !== "released";
    if (now.state === "ready") return old?.state !== "ready";
    return now.pr === "merged" && old?.pr !== "merged";
  });
}

/** True when a `--wait` would have nothing to wait for: a plan is ready already, or nothing can still change. */
export function nothingToWaitFor(lines: readonly PlanLine[]): "ready" | "settled" | null {
  if (lines.some((line) => line.state === "ready")) return "ready";
  return lines.some(mayChange) ? null : "settled";
}

/** What the plan commands read from `HerdrContext`: a plain subset, so this file never imports `command.ts`. */
export interface PlansEnv {
  paths: CliPaths;
  cwd: string;
  env: Env;
  now(): number;
  sleep(ms: number): Promise<void>;
  out: Out;
  /** Who is calling; tests fake it. Default: this process's own Claude session (`callerOf`). */
  caller?: () => Who | null;
  /** Whether a child's session is live, gone or ended; tests fake it. Default: this machine's. */
  process?: ClaimProcess;
  /** A branch's pull request; tests fake gh. */
  pr?: PrReader;
  /** `plans.mergeFiles` and case; tests fake the committed read. */
  filesCheck?: (cwd: string) => { ignore: readonly string[]; caseFold: boolean };
}

/** The pane a plan's `agent` names (`herdr:<core>/<address>`), read through hc. */
export function paneProbe(r: HcRunner, core: string): PaneProbe {
  return (agent, slug) => {
    if (agent === null) return { state: "none", status: null, address: null };
    const named = isHerdrAgent(agent) ? parseLeadId(agent.slice(HERDR_AGENT_PREFIX.length)) : null;
    if (named === null) return { state: "unknown", status: null, address: null };
    if (named.core !== core) return { state: "unknown", status: null, address: named.address };
    try {
      const pane = hcGet(r, named.address);
      // A reused address that is not this plan's child is not its pane.
      return pane.state === "live" && pane.labels[KIT_PLAN] === slug
        ? { state: "live", status: pane.status?.state ?? null, address: named.address }
        : { state: "gone", status: null, address: named.address };
    } catch (error) {
      if (error instanceof HcError && ["finished", "not_found"].includes(error.kind))
        return { state: "gone", status: null, address: named.address };
      throw error;
    }
  };
}

/** The live terminal labelled `kit.plan=<slug>`, read through hc (`ls` by label, then each one's own label). */
export function labelledProbe(r: HcRunner): (slug: string) => string | null {
  return (slug) => {
    for (const listed of hcList(r, { labels: { [KIT_PLAN]: slug } }).terminals) {
      try {
        const terminal = hcGet(r, listed.address);
        if (terminal.state === "live" && terminal.labels[KIT_PLAN] === slug)
          return terminal.address;
      } catch (error) {
        if (!(error instanceof HcError) || !["finished", "not_found"].includes(error.kind))
          throw error;
      }
    }
    return null;
  };
}

export type OpenedWorld =
  | { ok: true; world: PlansWorld; close(): void }
  /** `empty`: nothing is wrong, there is just no store yet, so there are no plans. */
  | { ok: false; why: string; fix: string; empty?: true };

/**
 * The world a plan command reads, for the project of `cwd`: the store (opened to write, since a
 * start reserves and `plans` releases), the default branch, `mergeFiles` and case, read before
 * any write lock. A caller with no session has no plans to lead.
 */
export function openPlansWorld(
  ctx: PlansEnv,
  r: HcRunner,
  core: string,
  cwd: string = ctx.cwd,
): OpenedWorld {
  const project = taskContext(cwd, ctx.env);
  if (!project.ok) return { ok: false, why: project.why, fix: "Run it in the project's folder." };
  if (project.repo === null)
    return {
      ok: false,
      why: "Plans live in a git repository: this folder is in none.",
      fix: "Run it in the project's git checkout.",
    };
  const who = ctx.caller ? ctx.caller() : callerOf({ env: ctx.env });
  if (who === null || !who.sessionId)
    return {
      ok: false,
      why: "Plans belong to a session: this one cannot be resolved.",
      fix: "Run it from a Claude Code session, in a Herdr terminal.",
    };
  if (!existsSync(workDbFile(ctx.paths)))
    return {
      ok: false,
      empty: true,
      why: "No task store exists yet: this project has no plans.",
      fix: "Lay a plan first (the plan-task skill).",
    };
  const db = openWorkDb(workDbFile(ctx.paths), { mode: "write" });
  try {
    const chosen = baseBranch(locateCheckout(cwd, { env: ctx.env }), ctx.env, project.repo);
    const check = ctx.filesCheck ? ctx.filesCheck(cwd) : planFilesCheck(cwd, ctx.env);
    return {
      ok: true,
      close: () => db.close(),
      world: {
        db,
        project: project.project,
        who,
        repo: project.repo,
        env: ctx.env,
        base: chosen.base,
        baseFrom: chosen.from,
        process: ctx.process ?? CLAIM_PROCESS,
        pr: ctx.pr ?? pullRequestState,
        pane: paneProbe(r, core),
        labelled: labelledProbe(r),
        check: { ignore: check.ignore, caseFold: check.caseFold },
        now: ctx.now,
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function show(out: Out, lines: readonly PlanLine[]): void {
  for (const line of lines)
    out.line(markOf(line.state), `#${line.number} ${line.plan}: ${line.text}`, {
      fix: line.fix ?? undefined,
    });
}

/**
 * `herdr plans --reserve <plan>` reserves the caller's own plan (`prepareReserve`); `--release`
 * lets go of a finished one (`releaseByHand`).
 *
 * `herdr plans`: one line per plan this session leads, with the live gates (D7). `--wait` polls
 * every `PLAN_POLL_MS` until a plan turns ready, a reservation is released or a reserved plan's
 * pull request merges; it prints what changed and ends. It ends at once when a plan is already
 * ready or nothing could still change, and at the timeout with the command to continue.
 */
export async function runPlans(
  args: { json: boolean; wait: boolean; timeoutMs?: number; release?: string; reserve?: string },
  ctx: PlansEnv,
  r: HcRunner,
  core: string,
  defaultTimeoutMs: number,
): Promise<number> {
  const opened = openPlansWorld(ctx, r, core);
  if (!opened.ok) {
    // No store yet is no failure for a listing: there are simply no plans. A plan named to
    // reserve or release is not there, so that is a refusal.
    const named = args.reserve ?? args.release;
    if (opened.empty && named !== undefined) {
      ctx.out.line("fail", `Plan "${named}" was not found: no task store yet.`, {
        fix: opened.fix,
      });
      return 1;
    }
    if (opened.empty) {
      if (args.json) ctx.out.json({ plans: [], changed: [] });
      else ctx.out.say(opened.why);
      return 0;
    }
    ctx.out.line("fail", opened.why, { fix: opened.fix });
    return 1;
  }
  try {
    if (args.release !== undefined) {
      const done = releaseByHand(opened.world, args.release);
      if (!done.ok) ctx.out.line("fail", done.why, { fix: done.fix });
      else ctx.out.line("removed", done.text);
      return done.ok ? 0 : 1;
    }
    if (args.reserve !== undefined) {
      const reserved = prepareReserve(opened.world, args.reserve);
      if (!reserved.ok) ctx.out.line("fail", reserved.why, { fix: reserved.fix });
      else
        ctx.out.line(
          "ok",
          `Reserved plan #${reserved.plan.number} ${reserved.plan.plan ?? reserved.plan.subject} for this session: start its first phase as usual.`,
        );
      return reserved.ok ? 0 : 1;
    }
    const judge = () => judgePlans(opened.world);
    const first = judge().lines;
    const finish = (lines: readonly PlanLine[], changed: readonly PlanLine[]) => {
      if (args.json) ctx.out.json({ plans: lines, changed });
      else if (lines.length === 0) ctx.out.say("No plans led by this session.");
      else {
        ctx.out.say(`Plans: ${summary(lines)}`);
        show(ctx.out, lines);
      }
      return 0;
    };
    if (!args.wait) return finish(first, []);
    const ended = nothingToWaitFor(first);
    if (ended !== null) {
      if (!args.json)
        ctx.out.line(
          "info",
          ended === "ready"
            ? "A plan is ready already: nothing to wait for."
            : "Nothing to wait for: no plan can change by itself.",
        );
      return finish(first, []);
    }
    const deadline = ctx.now() + (args.timeoutMs ?? defaultTimeoutMs);
    let before = first;
    while (ctx.now() < deadline) {
      await ctx.sleep(Math.min(PLAN_POLL_MS, Math.max(0, deadline - ctx.now())));
      const now = judge().lines;
      const changed = changesBetween(before, now);
      if (changed.length) {
        if (!args.json) {
          ctx.out.line("info", "A plan changed:");
          show(ctx.out, changed);
        }
        return finish(now, changed);
      }
      before = now;
    }
    if (!args.json) {
      ctx.out.line("info", "No plan changed yet.");
      ctx.out.say(
        `${COMMAND} herdr plans --wait${args.timeoutMs === undefined ? "" : ` --timeout ${args.timeoutMs / 1000}`}`,
      );
    } else ctx.out.json({ plans: before, changed: [], timeout: true });
    return 0;
  } finally {
    opened.close();
  }
}
