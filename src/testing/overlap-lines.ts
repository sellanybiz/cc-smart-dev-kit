// How the tests read an overlap warning (`warnOverlaps`): the lines of an answer, the opening
// words of a line or note, and a plan's `Overlap:` notes.
import type { TaskAnswer } from "../tasks/ops";
import type { WorkDb } from "../tasks/work/db";
import { notesOf } from "../tasks/work/queries";
import type { WorkTask } from "../tasks/work/types";

/** The overlap lines of an answer's text: its lines after the first that start `Overlap`. */
export function overlapLines(text: string): string[] {
  return text
    .split("\n")
    .slice(1)
    .filter((line) => line.startsWith("Overlap"));
}

/** The overlap lines of a task tool's answer, which must have passed. */
export function warned(answer: TaskAnswer): string[] {
  if (!answer.ok) throw new Error(answer.why);
  return overlapLines(answer.text);
}

/** The opening words of an overlap line or note: the two plans and what they share. */
export function sharedWords(line: string): string {
  const head = /^Overlap: (.*? share .*?)\.(?: |$)/.exec(line);
  if (head === null) throw new Error(`not an overlap line: ${line}`);
  return head[1] ?? "";
}

/** The `Overlap:` notes of a task, oldest first. */
export function overlapNotes(db: WorkDb, task: string | WorkTask): string[] {
  return notesOf(db, task)
    .map((note) => note.text)
    .filter((text) => text.startsWith("Overlap:"));
}
