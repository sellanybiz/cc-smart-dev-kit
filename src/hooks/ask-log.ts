/**
 * The record of what the guards asked: one JSON line per ask, in `<stateDir>/guard-asks.jsonl`
 * (the state folder, `cliPaths().stateDir`).
 *
 * Why a file: a guard's question is the person's judgment, and "which guard asked, and about
 * what" is worth keeping after the session is gone. The answer itself reaches Claude and the
 * hook log (`CC_SMART_DEV_KIT_HOOK_LOG`, which is a check's log, not the person's); this record is
 * the one a report can read.
 *
 * What a line holds: the time, the hook, the session, the tool and a short reason. **Never the
 * command's secrets**: a reason often quotes the command, so the frame writes it through
 * `maskedLine` (`src/gateway/plain-text.ts`, the one home for masking) first.
 *
 * The file is cc-smart-dev-kit's own state, written by the frame with one append per line. A file
 * that cannot be written never fails a hook: the frame turns the error into one line on
 * stderr and the answer stands (`src/hooks/run.ts`).
 *
 * It is kept small like `update.log`: past `LOG_MAX_BYTES` (`src/update/state.ts`, the one home
 * of that size) the newer half is kept. The cut is a temp file and a rename, so a reader never
 * sees half a file.
 */

import { join } from "node:path";
import { appendJsonLine } from "./jsonl-log";

/** The record's file name, in the state folder. */
export const ASK_LOG_FILE = "guard-asks.jsonl";

/** The longest reason a line holds, in characters: a question, not a transcript. */
export const ASK_REASON_MAX = 200;

/** One question a guard put to the person. */
export interface GuardAsk {
  /** When the guard asked (ms since the epoch, like `agent-launches.jsonl`). */
  at: number;
  /** The hook that asked (`job-route`). */
  hook: string;
  /** The session it happened in; empty when the input names none. */
  session: string;
  /** The tool the call was for (`Bash`); empty when the input names none. */
  tool: string;
  /** The question: one line, short, with anything that looks like a key masked. */
  reason: string;
}

/** Where the record lives. */
export function askLogFile(stateDir: string): string {
  return join(stateDir, ASK_LOG_FILE);
}

/**
 * Appends one ask, all of it in one write (`appendJsonLine`: the size rule and the folder
 * live there). Throws when the file cannot be written: the frame turns that into one stderr
 * line, and the hook's answer is not changed.
 */
export function appendAsk(file: string, ask: GuardAsk): void {
  appendJsonLine(file, ask);
}
