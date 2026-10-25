/**
 * Writing one workflow setting, in the place that setting really lives.
 *
 * - **The policy** — `autoCommit`, `openPr`, `alerts.sound`, … — goes into the person's own
 *   file, `~/.config/cc-smart-dev-kit/workflow.json` (folder 0700, file 0600, written atomically,
 *   the way the other config files are), or into the project's `workflow` object with
 *   `writeProjectSetting`. Every other field and the file's own indentation stay as they are.
 * - **A switch is never stored.** `switches.statusLine` is Claude Code's own `statusLine` key
 *   (the one `setup --statusline` writes, through `applyManagedJson`: a status line someone
 *   else set is never overwritten), `switches.updateHold` is the update-hold file behind
 *   `update --hold`, and `switches.sessionNames` / `switches.jobRoute` are the project's
 *   `sessionNames` and `jobs.route`. So each is written where it really lives, and a request
 *   for the other place is refused with a line saying where to run it instead.
 * - **`value` `undefined` removes the setting**, so the value falls back: the project's, the
 *   person's, then the built-in default (`resolve.ts`).
 *
 * What is written is validated first (the workflow schema for the person's file, the whole
 * config for the project's), so a wrong value can never reach a file. Returns one plain line
 * for the person; anything that must not be written throws, and nothing is written.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type CliPaths, cliPaths, tildify } from "../cli/paths";
import { checkCcSmartDevKitConfig } from "../project/config";
import { raisedRequires, requiresFloor, requiresTooLow } from "../project/init";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { jsonTextFor } from "../setup/json-edit";
import { applyManagedJson, isObject, readJsonObject } from "../setup/managed-json";
import { STATUSLINE_KEY, statuslineSetting } from "../setup/statusline";
import { atomicWrite, backupFile, realTarget } from "../setup/write";
import { heldSince, hold, resume, updateFiles } from "../update/state";
import { describeIssues } from "../zod-issues";
import { personalWorkflowFile, WorkflowConfigError } from "./resolve";
import {
  isSwitchKey,
  type SwitchName,
  switchOf,
  WORKFLOW_KEYS,
  type WorkflowKey,
  workflowSchema,
} from "./schema";

type Env = Record<string, string | undefined>;

/** A key nobody may set, said with the list of keys there is. */
function unknownKey(key: string): Error {
  return new Error(`Unknown setting: ${key}. The settings are: ${WORKFLOW_KEYS.join(", ")}`);
}

/** The key, as one of the settings there are; a typo is refused before anything is read. */
function requireKey(key: string): WorkflowKey {
  if (!WORKFLOW_KEYS.includes(key as WorkflowKey)) throw unknownKey(key);
  return key as WorkflowKey;
}

/** `data` with `path` set to `value`; the objects along the way are made when missing. */
function setLeaf(data: Record<string, unknown>, path: string[], value: unknown): void {
  let node = data;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (isObject(next)) {
      node = next;
    } else {
      const made: Record<string, unknown> = {};
      node[segment] = made;
      node = made;
    }
  }
  const leaf = path.at(-1);
  if (leaf !== undefined) node[leaf] = value;
}

/** `data` without `path`. A group left empty goes too, so the file stays short. */
function removeLeaf(data: Record<string, unknown>, path: string[]): void {
  const parents: Array<{ parent: Record<string, unknown>; segment: string }> = [];
  let node = data;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (!isObject(next)) return;
    parents.push({ parent: node, segment });
    node = next;
  }
  const leaf = path.at(-1);
  if (leaf !== undefined) delete node[leaf];
  for (const { parent, segment } of parents.reverse()) {
    const child = parent[segment];
    if (isObject(child) && Object.keys(child).length === 0) delete parent[segment];
  }
}

/** A value as one line: an unset one, a list of alerts, a number, a boolean. */
function saidValue(key: WorkflowKey, value: unknown): string {
  if (value === undefined) return `${key} unset`;
  if (Array.isArray(value)) return `${key} = ${value.join(", ")}`;
  return `${key} = ${String(value)}`;
}

/** `+` created, `~` changed, `-` removed: the line a write that happened prints. */
function shownWrite(shown: string, key: WorkflowKey, value: unknown, created: boolean): string {
  const mark = value === undefined ? "-" : created ? "+" : "~";
  return `${mark} ${shown}: ${saidValue(key, value)}`;
}

/** The line a write that changed nothing prints. */
function shownNothing(shown: string, key: WorkflowKey, value: unknown): string {
  return `= ${shown}: ${value === undefined ? `${key} was not set` : `${saidValue(key, value)} (already set)`}`;
}

/**
 * One policy key in the person's own defaults: `~/.config/cc-smart-dev-kit/workflow.json`.
 * `value` undefined removes it, so the built-in default (or the project's value) holds again.
 */
export function writePersonalSetting(paths: CliPaths, key: string, value: unknown): string {
  const wanted = requireKey(key);
  if (isSwitchKey(wanted)) return writePersonalSwitch(paths, wanted, value);
  const file = personalWorkflowFile(paths);
  const { data, indent, text } = readJsonObject(file);
  const before = structuredClone(data);
  if (value === undefined) removeLeaf(data, wanted.split("."));
  else setLeaf(data, wanted.split("."), value);
  const checked = workflowSchema.safeParse(data);
  if (!checked.success) {
    throw new WorkflowConfigError(`Invalid ${file}: ${describeIssues(checked.error.issues)}`);
  }
  const shown = tildify(file, paths.home);
  if (Bun.deepEquals(before, data, true)) return shownNothing(shown, wanted, value);
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  atomicWrite(file, jsonTextFor(text, data, indent), 0o600);
  return shownWrite(shown, wanted, value, text === null);
}

/**
 * One setting in the project's committed `.claude/cc-smart-dev-kit.json`: the policy under
 * `workflow`, and the two switches that are project settings (`sessionNames`, `jobs.route`).
 * The file's other fields and its indentation stay. The result must still parse as a
 * `cc-smart-dev-kit.json`: a write that would leave it invalid throws and writes nothing.
 */
export function writeProjectSetting(
  cwd: string,
  key: string,
  value: unknown,
  env: Env = process.env,
): string {
  const wanted = requireKey(key);
  if (isSwitchKey(wanted)) return writeProjectSwitch(cwd, wanted, value, env);
  return writeProjectFile(cwd, ["workflow", ...wanted.split(".")], wanted, value, env);
}

/** The project's config file, or an error saying how to get one. */
function projectFile(cwd: string, env: Env): string {
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null) {
    throw new Error(`${cwd} is not in a git project: run this inside the project`);
  }
  const { configFile } = loadProjectConfig(checkout);
  if (configFile === null) {
    throw new Error(
      `${checkout.root} has no .claude/cc-smart-dev-kit.json: run \`cc-smart-dev-kit project init\` there first, or set this in your own defaults (without --project)`,
    );
  }
  return configFile;
}

/** One leaf of the project's own file, kept valid and formatted as it was. */
function writeProjectFile(
  cwd: string,
  path: string[],
  key: WorkflowKey,
  value: unknown,
  env: Env,
): string {
  const file = projectFile(cwd, env);
  const { data, indent, text } = readJsonObject(file);
  const before = structuredClone(data);
  if (value === undefined) removeLeaf(data, path);
  else setLeaf(data, path, value);
  // A write that brings a field a newer plugin added raises `requires` (never lowers it), as
  // `project init` does: a teammate on an older plugin then hears "update", not every guard
  // asking. Only then: a write the file's old floor already covers leaves `requires` alone.
  // The file's own `requires` counts too: one an older plugin wrote below its fields (1.2.0 with
  // `crew.handoffTokens` under `>=1.0`) is raised by any write, so the teammate hears "update".
  const needed = requiresFloor(data);
  if (
    Bun.semver.order(needed.version, requiresFloor(before).version) > 0 ||
    requiresTooLow(data.requires, needed.version)
  ) {
    data.requires = raisedRequires(data.requires, needed.floor, needed.version);
  }
  // The same checks every reader of the file runs (`requires`, the retired engine fields, the
  // strict parse), so this never writes a file the hooks would then refuse.
  checkCcSmartDevKitConfig(data, file);
  if (Bun.deepEquals(before, data, true)) return shownNothing(file, key, value);
  // A backup first, in the state folder: `restore` does not undo a project's file (it is the
  // project's, committed to git), so the backup is only there to look at.
  backupFile(cliPaths(env).stateDir, file);
  // `realTarget`: a file linked into a dotfiles repo stays a link, and its target gets the
  // change — an atomic write straight at the link would replace it with a plain file.
  atomicWrite(realTarget(file), jsonTextFor(text, data, indent), 0o644);
  return shownWrite(file, key, value, text === null);
}

/** `true`/`false`, or `undefined` for "unset". Anything else is refused. */
function switchValue(key: WorkflowKey, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new Error(`${key} is true or false`);
}

/** A switch of the person's own: the status line, or the update hold. */
function writePersonalSwitch(
  paths: CliPaths,
  key: `switches.${SwitchName}`,
  value: unknown,
): string {
  const name = switchOf(key);
  const wanted = switchValue(key, value);
  if (name === "statusLine") return writeStatusLine(paths, wanted);
  if (name === "updateHold") return writeUpdateHold(paths, wanted);
  throw new Error(
    `${key} is the project's setting (${name === "sessionNames" ? "sessionNames" : "jobs.route"} in .claude/cc-smart-dev-kit.json): run it with --project inside the project`,
  );
}

/** A switch of the project's own: `sessionNames`, or `jobs.route`. */
function writeProjectSwitch(
  cwd: string,
  key: `switches.${SwitchName}`,
  value: unknown,
  env: Env,
): string {
  const name = switchOf(key);
  switchValue(key, value);
  if (name === "sessionNames") {
    return writeProjectFile(cwd, ["sessionNames"], "switches.sessionNames", value, env);
  }
  if (name === "jobRoute") {
    return writeProjectFile(cwd, ["jobs", "route"], "switches.jobRoute", value, env);
  }
  throw new Error(
    `${key} is your own setting, not the project's: run it without --project (the ${name === "statusLine" ? "status line" : "update hold"} is per person, per machine)`,
  );
}

/** Claude Code's own `statusLine` key, through the one writer for a user's settings file. */
function writeStatusLine(paths: CliPaths, value: boolean | undefined): string {
  const shown = tildify(paths.settingsFile, paths.home);
  const on = value === true;
  const result = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    ...(on ? { set: [[STATUSLINE_KEY, statuslineSetting(paths)]] } : { remove: [STATUSLINE_KEY] }),
  });
  if (result.changes.length === 0) {
    const why = result.skipped.map((entry) => entry.reason).join("; ");
    return `= ${shown}: the cc-smart-dev-kit status line is ${on ? "already on" : "not on"}${why === "" ? "" : ` (${why})`}`;
  }
  return `${on ? "~" : "-"} ${shown}: the cc-smart-dev-kit status line is ${on ? "on" : "off"}`;
}

/** The update hold file behind `update --hold`: the one place that decides whether it is on. */
function writeUpdateHold(paths: CliPaths, value: boolean | undefined): string {
  const files = updateFiles(paths.stateDir);
  if (value === true) {
    return hold(files, Date.now())
      ? `+ ${tildify(files.hold, paths.home)}: background updates are on hold`
      : `= background updates were already on hold (since ${heldSince(files)})`;
  }
  return resume(files)
    ? `- ${tildify(files.hold, paths.home)}: background updates resume`
    : "= background updates were not on hold";
}
