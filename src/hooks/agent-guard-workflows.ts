/**
 * The script a Workflow call runs when its input holds no inline `script`, found the way Claude
 * Code finds it — so the Agent guard (`agent-guard.ts`) judges every run, not only an inline one.
 *
 * Proved live on 2.1.306 (`docs/claude-code-contract.md`): a Workflow call's PreToolUse
 * `tool_input` is `{"name":"probe"}` for a saved workflow, `{"scriptPath":"<path>"}` for a path
 * run, and `{"name":"<plugin>:<meta.name>"}` for a plugin's — never a `script`. Read from the
 * 2.1.306 binary, and followed here:
 *   - `scriptPath` is read as it is, relative to the cwd; a file over `WORKFLOW_SCRIPT_MAX_BYTES`
 *     is refused;
 *   - a bare name is the `meta.name` of a `.js` file in a `.claude/workflows/` folder, from the cwd
 *     up to the repo root (the home folder is never one of them), then in the user's
 *     `<config>/workflows/`. The nearest folder wins, the project's over the user's. The FILE's
 *     name plays no part;
 *   - `<plugin>:<name>` is the plugin's `workflows/` folder, or the paths its manifest's
 *     `workflows` lists instead;
 *   - `meta` must be the first statement, `export const meta = { … }`, a pure literal with a
 *     non-empty `name` and `description` (`workflowMetaName`); a file without one is no workflow.
 *
 * A run it cannot find is `unreadable`, never guessed: a built-in workflow (its script is inside
 * Claude Code), a missing file, or two files that claim one name in one folder — Claude Code then
 * runs whichever the folder lists last, and the guard cannot know which.
 *
 * The plain-JavaScript readers here (a string literal, a comment) are the guard's own: one home,
 * for the script reader in `agent-guard.ts` and for `meta`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { PLUGIN } from "../build-info/names";
import { installsOfPlugin, type PluginInstallRecord } from "../setup/installed-plugins";

/**
 * The largest script Claude Code runs (2.1.306, read from its binary): a larger saved file is
 * skipped, and a larger `scriptPath` is refused.
 */
export const WORKFLOW_SCRIPT_MAX_BYTES = 524_288;

/** A string literal's value at `from`, and the index after it; null when it is not one. */
export function stringAt(text: string, from: number): null | { end: number; value: string } {
  const quote = text[from];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let value = "";
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\") {
      // A literal escape with a value (`\n`, `\"`) is read as the character it names.
      const next = text[index + 1] ?? "";
      value += next === "n" ? "\n" : next;
      index += 1;
      continue;
    }
    if (char === quote) return { end: index + 1, value };
    value += char;
  }
  return null;
}

/**
 * True when the literal at `[from, end)` builds its text at run time: a template with an
 * unescaped `${…}`. Its value is not the text between the backticks, so nothing is read from
 * it — `model: \`op${n}us\`` names no model the guard can prove.
 */
function interpolated(text: string, from: number, end: number): boolean {
  for (let index = from + 1; index < end - 1; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "$" && text[index + 1] === "{") return true;
  }
  return false;
}

/** A **fixed** string literal's value at `from`; null when it is not one, or is built at run time. */
export function literalAt(text: string, from: number): null | { end: number; value: string } {
  const literal = stringAt(text, from);
  if (literal === null) return null;
  return text[from] === "`" && interpolated(text, from, literal.end) ? null : literal;
}

/** The index of the first character at or after `from` that is neither blank nor a comment. */
export function skipBlank(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    if (/\s/.test(text[index] ?? "")) {
      index += 1;
    } else if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end + 1;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      break;
    }
  }
  return index;
}

/**
 * A fixed string literal at `from` that is the WHOLE value there: the next thing after it is
 * one of `ends` (`,` `)` `}`), not an operator that would change it (`"high" && "max"`,
 * `"a" + b`). Null otherwise.
 */
export function wholeLiteralAt(text: string, from: number, ends: string): null | string {
  const literal = literalAt(text, from);
  if (literal === null) return null;
  const next = text[skipBlank(text, literal.end)] ?? "";
  return ends.includes(next) ? literal.value : null;
}

/** A pure literal in `meta`; `FAIL` when the text there is anything else. */
const FAIL = Symbol("not a pure literal");

/** Keys a pure literal never holds: Claude Code refuses them in `meta`. */
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];

/** The number shape Claude Code's `meta` reader accepts, with an optional leading `-`. */
const NUMBER = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;

/** A pure literal value at `from` (after blanks), and the index after it; FAIL when it is not one. */
function literalValue(text: string, from: number): typeof FAIL | { end: number; value: unknown } {
  const at = skipBlank(text, from);
  const char = text[at] ?? "";
  if (char === '"' || char === "'" || char === "`") {
    const literal = literalAt(text, at);
    return literal === null ? FAIL : { end: literal.end, value: literal.value };
  }
  if (char === "{") return objectValue(text, at);
  if (char === "[") return arrayValue(text, at);
  const number = NUMBER.exec(text.slice(at));
  if (number !== null) return { end: at + number[0].length, value: Number(number[0]) };
  const word = /^(true|false|null)(?![\w$])/.exec(text.slice(at));
  if (word !== null) {
    const values = { false: false, null: null, true: true } as const;
    return { end: at + word[0].length, value: values[word[1] as keyof typeof values] };
  }
  return FAIL;
}

/** An object literal at `from` (its `{`): plain `key: value` pairs only, trailing comma allowed. */
function objectValue(text: string, from: number): typeof FAIL | { end: number; value: unknown } {
  const value: Record<string, unknown> = {};
  let at = skipBlank(text, from + 1);
  while (text[at] !== "}") {
    let key: string;
    const quoted = literalAt(text, at);
    const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(at))?.[0];
    if (quoted !== null) {
      key = quoted.value;
      at = quoted.end;
    } else if (name !== undefined) {
      key = name;
      at += name.length;
    } else {
      // A computed key, a spread, a number key, or the end of the text.
      return FAIL;
    }
    if (RESERVED_KEYS.includes(key) || key in value) return FAIL;
    at = skipBlank(text, at);
    // Shorthand (`{ name }`), a method, an accessor: not a plain property.
    if (text[at] !== ":") return FAIL;
    const inner = literalValue(text, at + 1);
    if (inner === FAIL) return FAIL;
    value[key] = inner.value;
    at = skipBlank(text, inner.end);
    if (text[at] === ",") at = skipBlank(text, at + 1);
    else if (text[at] !== "}") return FAIL;
  }
  return { end: at + 1, value };
}

/** An array literal at `from` (its `[`): no holes, trailing comma allowed. */
function arrayValue(text: string, from: number): typeof FAIL | { end: number; value: unknown } {
  const value: unknown[] = [];
  let at = skipBlank(text, from + 1);
  while (text[at] !== "]") {
    const inner = literalValue(text, at);
    if (inner === FAIL) return FAIL;
    value.push(inner.value);
    at = skipBlank(text, inner.end);
    if (text[at] === ",") at = skipBlank(text, at + 1);
    else if (text[at] !== "]") return FAIL;
  }
  return { end: at + 1, value };
}

/**
 * The `meta.name` of a workflow script, read the way Claude Code reads it: `export const meta =
 * { … }` as the first statement (blanks and comments may come before it), a pure literal, with a
 * non-empty `name` and `description`. Null when the script has no such `meta`: Claude Code then
 * loads no workflow from that file.
 */
export function workflowMetaName(script: string): null | string {
  const start = skipBlank(script, 0);
  const head = /^export\s+const\s+meta\s*=\s*(?=\{)/.exec(script.slice(start));
  if (head === null) return null;
  const meta = objectValue(script, start + head[0].length);
  if (meta === FAIL) return null;
  const after = script[skipBlank(script, meta.end)];
  // The statement ends there: `;`, a new line before the next one, or the end of the script.
  if (
    after !== undefined &&
    after !== ";" &&
    !/\n/.test(script.slice(meta.end, skipBlank(script, meta.end)))
  ) {
    return null;
  }
  const { description, name } = meta.value as Record<string, unknown>;
  if (typeof name !== "string" || name === "") return null;
  if (typeof description !== "string" || description === "") return null;
  return name;
}

/** A script the guard found: the file and its text, line ends as Claude Code reads them. */
export interface FoundScript {
  file: string;
  script: string;
}

/** Where a script is, or why the guard cannot read it (a sentence for the person). */
export type ScriptLookup = FoundScript | { unreadable: string };

/** What the guard needs to find a workflow from where the session is. */
export interface WorkflowPlace {
  /** The Claude Code config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`): its `workflows/`. */
  claudeConfigDir: string;
  /**
   * The hook input's `cwd`: where the walk for `.claude/workflows/` starts. Empty when the input
   * has none: then no project folder is read, and a relative path cannot be found — never the
   * hook's own working folder, which is not the session's.
   */
  cwd: string;
  /** The home folder: the walk never reads it as a project (its `.claude` is the user's). */
  home: string;
  /** Claude Code's `installed_plugins.json`, for a plugin's workflow. */
  installedPluginsFile: string;
  /** This plugin's own folder (`CLAUDE_PLUGIN_ROOT`), for one of its own workflows; else null. */
  pluginRoot: null | string;
}

/** Claude Code reads a script with its Windows line ends as one `\n` each. */
function normalized(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

/** The script at `path` (relative to `cwd`), or why it cannot be read. */
export function scriptAtPath(path: string, cwd: string): ScriptLookup {
  if (cwd === "" && !isAbsolute(path)) {
    return {
      unreadable: `The workflow script \`${path}\` is a relative path, and the hook input names no folder it is relative to.`,
    };
  }
  const file = resolve(cwd, path);
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return { unreadable: `The workflow script \`${file}\` is not a file.` };
    size = stat.size;
  } catch {
    return { unreadable: `The workflow script \`${file}\` does not exist.` };
  }
  if (size > WORKFLOW_SCRIPT_MAX_BYTES) {
    return {
      unreadable: `The workflow script \`${file}\` is larger than the ${WORKFLOW_SCRIPT_MAX_BYTES} bytes Claude Code runs.`,
    };
  }
  try {
    return { file, script: normalized(readFileSync(file, "utf8")) };
  } catch {
    return { unreadable: `The workflow script \`${file}\` cannot be read.` };
  }
}

/** The workflow files of one folder (`.js`, within the size limit), by name; none when it is not there. */
function workflowFiles(folder: string): string[] {
  let names: string[];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".js"));
  } catch {
    return [];
  }
  return names.sort().map((name) => join(folder, name));
}

/** The scripts among `files` whose `meta.name` is `name`. A file that cannot be read is skipped, as Claude Code skips it. */
function claiming(files: readonly string[], name: string): FoundScript[] {
  const found: FoundScript[] = [];
  for (const file of files) {
    try {
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > WORKFLOW_SCRIPT_MAX_BYTES) continue;
      const script = normalized(readFileSync(file, "utf8"));
      if (workflowMetaName(script) === name) found.push({ file, script });
    } catch {
      // Gone since the listing, or unreadable: Claude Code loads no workflow from it either.
    }
  }
  return found;
}

/**
 * The one script among `found` (all from one folder), or why there is no one: two files that
 * claim one name with different texts leave the guard unable to say which Claude Code runs.
 */
function oneOf(found: readonly FoundScript[], name: string): ScriptLookup | null {
  const [first] = found;
  if (first === undefined) return null;
  const other = found.find((one) => one.script !== first.script);
  if (other === undefined) return first;
  return {
    unreadable: `Two files claim the workflow name \`${name}\`: \`${first.file}\` and \`${other.file}\`. Claude Code runs one of them, and which one depends on the order the folder lists them, so the guard cannot tell. Give each workflow its own \`meta.name\`.`,
  };
}

/**
 * The `.claude/workflows/` folders Claude Code reads for a bare name, nearest first: from `cwd`
 * up to the repo root (the first folder with a `.git`), never the home folder itself, then the
 * user's `<config>/workflows/`.
 */
function savedFolders(place: WorkflowPlace): string[] {
  const folders: string[] = [];
  let at = resolve(place.cwd);
  const home = resolve(place.home);
  while (place.cwd !== "" && at !== home) {
    folders.push(join(at, ".claude", "workflows"));
    if (existsSync(join(at, ".git"))) break;
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  folders.push(join(place.claudeConfigDir, "workflows"));
  return folders;
}

/** Said when a name has no file the guard can find. */
function noFile(name: string): { unreadable: string } {
  return {
    unreadable: `The workflow \`${name}\` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.`,
  };
}

/** True when `folder` is `inside` or a folder in it. */
function within(folder: string, inside: string): boolean {
  const root = resolve(inside);
  const path = resolve(folder);
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The installed folder of the plugin `plugin`, the way the session most likely loaded it: this
 * plugin's own `CLAUDE_PLUGIN_ROOT`; else a `project` or `local` install whose project holds the
 * cwd (the deepest first), else the `user` one — the first whose folder is there.
 */
function pluginFolder(plugin: string, place: WorkflowPlace): null | string {
  if (plugin === PLUGIN && place.pluginRoot !== null) return place.pluginRoot;
  const installs = installsOfPlugin(place.installedPluginsFile, plugin);
  const project = installs
    .filter(
      (one): one is PluginInstallRecord & { projectPath: string } =>
        one.scope !== "user" &&
        one.projectPath !== null &&
        place.cwd !== "" &&
        within(place.cwd, one.projectPath),
    )
    .sort((a, b) => b.projectPath.length - a.projectPath.length);
  const user = installs.filter((one) => one.scope === "user");
  return [...project, ...user].find((one) => existsSync(one.installPath))?.installPath ?? null;
}

/** The workflow files a plugin loads: its manifest's `workflows` paths when it lists any, else its `workflows/` folder. */
function pluginWorkflowFiles(root: string): string[] {
  let listed: unknown;
  try {
    const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"));
    listed = manifest?.workflows ?? manifest?.experimental?.workflows;
  } catch {
    // No manifest, or one that cannot be read: the default folder.
    listed = undefined;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : null;
  if (paths === null) return workflowFiles(join(root, "workflows"));
  return paths
    .filter((one): one is string => typeof one === "string")
    .flatMap((one) => {
      const path = resolve(root, one);
      try {
        if (statSync(path).isDirectory()) return workflowFiles(path);
      } catch {
        return [];
      }
      return path.endsWith(".js") ? [path] : [];
    });
}

/**
 * The script a workflow NAME runs (`Workflow({ name })`, or a script's `workflow('<name>')`), or
 * why the guard cannot read it: a plugin's `<plugin>:<name>` from that plugin's folder, a bare
 * name from the saved folders (`savedFolders`, the nearest that has it).
 */
export function scriptByName(name: string, place: WorkflowPlace): ScriptLookup {
  const colon = name.indexOf(":");
  if (colon !== -1) {
    const plugin = name.slice(0, colon);
    const own = name.slice(colon + 1);
    const root = pluginFolder(plugin, place);
    if (root === null) {
      return {
        unreadable: `The workflow \`${name}\` belongs to the plugin \`${plugin}\`, and Claude Code's installed_plugins.json names no installed folder for it.`,
      };
    }
    return (
      oneOf(claiming(pluginWorkflowFiles(root), own), name) ?? {
        unreadable: `The workflow \`${name}\`: the plugin's folder \`${root}\` holds no workflow named \`${own}\`.`,
      }
    );
  }
  for (const folder of savedFolders(place)) {
    const found = oneOf(claiming(workflowFiles(folder), name), name);
    if (found !== null) return found;
  }
  return noFile(name);
}
