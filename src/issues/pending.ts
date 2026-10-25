/**
 * The marks a crew merge still owes GitHub (decision D67). The watch knows a merge once; GitHub
 * may not answer then. So a merge **queues** one mark per issue in a file of its own (this file's
 * memory), and every watch pass **settles** the queue: a mark leaves it when GitHub has taken it
 * (or when there is nothing left to do — the issue is closed or gone, or the project does not use
 * issues), and stays, tried again after `RETRY_MS`, when GitHub could not be reached. The lead
 * hears one line when a mark first fails, and one when it is done.
 *
 * Why a file: the crew session's record is removed right after its merge, and the watch may be
 * restarted at any moment; the queue is the only thing that outlives both. A mark queued twice
 * (the same issue, branch and tip) is one entry, and the marker in the comment (`fixed.ts`) keeps
 * a mark that reached GitHub but was not dequeued from being posted twice.
 *
 * The queue is per lead (`<store>/issue-marks/<lead session>.json`): one watch acts for a lead,
 * so no two writers share a file.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeJsonFile } from "../crew/store";
import type { IssueWorld } from "./file";
import { type FixedMark, markFixed, openGate } from "./fixed";

/** How long a mark GitHub did not take waits before the next try. */
export const RETRY_MS = 5 * 60_000;

const sha = z.string().regex(/^[0-9a-f]{40}$/);

const pendingSchema = z.object({
  marks: z.array(
    z.object({
      base: z.string().min(1),
      branch: z.string().min(1),
      issue: z.number().int().positive(),
      merge: sha.nullable(),
      /** True once the lead was told this mark failed: a retry does not say it again. */
      told: z.boolean().default(false),
      tip: sha,
      /** When it was last tried (milliseconds); absent: never, so the next pass tries it. */
      triedAt: z.number().int().min(0).optional(),
    }),
  ),
  version: z.literal(1),
});

type Pending = z.infer<typeof pendingSchema>["marks"][number];

/** What is queued; none when the file is not there or cannot be read (a queue never blocks a pass). */
export function readPending(file: string): Pending[] {
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data.marks : [];
  } catch {
    return [];
  }
}

function writePending(file: string, marks: Pending[]): void {
  writeJsonFile(file, { marks, version: 1 });
}

/** One merge of one issue: its commit when known (a hand-off chain merges under one), else its tip. */
const keyOf = (mark: FixedMark): string =>
  `${mark.issue}\n${mark.merge ?? `${mark.branch}\n${mark.tip}`}`;

/** Queue marks; one already queued (the same issue, branch and tip) is kept as it is. */
export function queueMarks(file: string, marks: readonly FixedMark[]): void {
  if (marks.length === 0) return;
  const queued = readPending(file);
  const have = new Set(queued.map(keyOf));
  const added = marks.filter((mark) => {
    if (have.has(keyOf(mark))) return false;
    have.add(keyOf(mark));
    return true;
  });
  if (added.length === 0) return;
  writePending(file, [...queued, ...added.map((mark) => ({ ...mark, told: false }))]);
}

/** How many due marks one watch pass settles; the rest stay due for the next pass. */
export const MARKS_PER_PASS = 3;

/**
 * How long one watch pass may spend on GitHub, whatever the work: the poll for new issues
 * (`feed.ts`) and the marks share it. A `gh` call can take 10-30 s, and the watch has its own
 * work to do (the crew's lines, the starts, the stops), so the issue work never holds a pass.
 */
export const ISSUE_WORK_MS = 45_000;

/** What one pass may still spend on GitHub: a count of marks, and a time. */
export interface PassBudget {
  clock: () => number;
  deadline: number;
  marks: number;
}

/** A fresh budget for one pass, from `clock` now. */
export function passBudget(
  clock: () => number,
  limits: { marks?: number; ms?: number } = {},
): PassBudget {
  return {
    clock,
    deadline: clock() + (limits.ms ?? ISSUE_WORK_MS),
    marks: limits.marks ?? MARKS_PER_PASS,
  };
}

/** True while the pass has time for another call. */
export function hasTime(budget: PassBudget): boolean {
  return budget.clock() < budget.deadline;
}

/** Why a mark is worth a line to the lead, said in plain words. */
const where = (mark: FixedMark): string => `#${mark.issue} (${mark.branch})`;

/**
 * Try the queued marks that are due, at most what `budget` still allows (the rest stay queued and
 * due). Returns the lines for the lead. Never throws: a gate that fails marks the due entries it
 * was to try as tried and says it once. `gh` and the clock come from the caller.
 */
export async function settleMarks(
  file: string,
  world: IssueWorld,
  now: number,
  budget: PassBudget = passBudget(() => now),
): Promise<string[]> {
  const queued = readPending(file);
  const allDue = queued.filter(
    (mark) => mark.triedAt === undefined || now - mark.triedAt >= RETRY_MS,
  );
  if (allDue.length === 0 || budget.marks <= 0 || !hasTime(budget)) return [];
  const due = allDue.slice(0, budget.marks);
  const lines: string[] = [];
  const gate = await openGate(world);
  const left: Pending[] = queued.filter((mark) => !due.includes(mark));
  if (gate.kind === "off") {
    // The project does not use issues (or no longer does): nothing to mark, nothing to keep.
    writePending(file, left);
    return [];
  }
  if (gate.kind === "failed") {
    for (const mark of due) left.push({ ...mark, told: true, triedAt: now });
    const first = due.filter((mark) => !mark.told);
    if (first.length > 0) {
      lines.push(
        `issues: could not mark ${first.map(where).join(", ")} fixed (${gate.why}); it is tried again every ${RETRY_MS / 60_000} minutes`,
      );
    }
    writePending(file, left);
    return lines;
  }
  for (const mark of due) {
    // The time can run out inside the loop (a slow `gh`): the rest stay queued, untouched.
    if (!hasTime(budget)) {
      left.push(mark);
      continue;
    }
    budget.marks -= 1;
    const done = await markFixed(gate, mark);
    if (done.kind === "failed") {
      left.push({ ...mark, told: true, triedAt: now });
      if (!mark.told) {
        lines.push(
          `issues: could not mark ${where(mark)} fixed (${done.why}); it is tried again every ${RETRY_MS / 60_000} minutes`,
        );
      }
    } else if (done.kind === "marked") {
      lines.push(
        `issues: ${where(mark)} marked fixed on ${mark.base}${done.commented || done.labeled ? "" : " (it was already)"}; it closes when ${mark.base} ships`,
      );
    } else if (done.kind === "gone") {
      lines.push(`issues: #${mark.issue} does not exist on GitHub; nothing to mark`);
    } else if (done.kind === "refused") {
      lines.push(`issues: ${done.why}`);
    }
    // "closed": nothing to say; the issue is settled.
  }
  writePending(file, left);
  return lines;
}
