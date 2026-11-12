import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { atomicWrite } from "../setup/write";
/** Encode core ids too: neither an address nor a name may escape the private folder. */
export function briefPath(stateDir: string, core: string, name: string): string {
  return join(
    stateDir,
    "herdr",
    "briefs",
    `${encodeURIComponent(core)}-${encodeURIComponent(name)}`,
    "brief.md",
  );
}
export async function writeBrief(
  stateDir: string,
  core: string,
  name: string,
  text: string,
  linked: boolean,
  task?: string,
): Promise<string> {
  const file = briefPath(stateDir, core, name);
  await writePrivate(
    file,
    `${text}\n${task ? `\nYour task: ${task}\nsave a \`Report:\` note with task_note; never take, update or close the task.\n` : ""}${linked ? `\nWhen done or stuck, report with: \`${COMMAND} herdr report "<one paragraph>"\`; write long results to a file and report its path. Start no sessions or agents of your own unless this brief says so.\n` : ""}`,
  );
  return file;
}
export async function writePrivate(file: string, text: string): Promise<void> {
  const folder = dirname(file);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  atomicWrite(file, text, 0o600);
}

export function reportPath(stateDir: string, core: string, name: string): string {
  return join(
    dirname(briefPath(stateDir, core, name)),
    `report-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.md`,
  );
}
