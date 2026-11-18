import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CliPaths } from "../cli/paths";
import { stringField } from "../hooks/io";
import { isInsideOnDisk, sameFolderOnDisk } from "../path-compare";
import { readFrontmatterHeader } from "../project/frontmatter";
import { installsOfPlugin } from "../setup/installed-plugins";

/** The fields a definition supplies to the launch policy. `inherit` supplies no model. */
export interface AgentDefinition {
  model: null | string;
  effort: null | string;
  /** True when Claude Code's own built-in answers the name: no managed, project or user file claims it. */
  builtIn?: true;
}

export interface AgentPlace {
  /** The folders: the managed agents folder too (`CliPaths.managedAgentsDir`; a temp one in a test). */
  paths: Pick<CliPaths, "home" | "claudeConfigDir" | "installedPluginsFile" | "managedAgentsDir">;
  checkout: null | string;
  cwd?: null | string;
}

/** The deepest folder a scan follows below an agents folder (symlinked folders included). */
export const AGENT_SCAN_MAX_DEPTH = 8;

/** The most files and folders one lookup reads, over every agents folder it scans. */
export const AGENT_SCAN_MAX_ENTRIES = 2000;

/** Thrown when a scan passes a cap: the lookup then refuses, rather than judge a partial scan. */
class ScanTooLarge extends Error {}

/** One lookup's scan budget, shared by every folder it reads. */
interface Budget {
  entries: number;
}

/** Fixed built-ins on 2.1.318; conditional/inherited models are deliberately unknown.
 * Evidence and limits: docs/claude-code-contract.md, Hooks. No built-in pins effort. */
const BUILT_INS: Readonly<Record<string, null | string>> = {
  "claude-code-guide": "haiku",
  "statusline-setup": "sonnet",
  "web-fetch": null,
  Explore: null,
  Plan: null,
  "general-purpose": null,
};

/**
 * Every `.md` file under `path`, following symlinks; a folder seen twice (a loop) is read once.
 * Throws `ScanTooLarge` past `AGENT_SCAN_MAX_DEPTH` or `AGENT_SCAN_MAX_ENTRIES`.
 */
function files(path: string, budget: Budget, depth = 0, visited = new Set<string>()): string[] {
  const found = readable(() => ({ real: realpathSync(path), stat: statSync(path) }));
  if (found === null || visited.has(found.real)) return [];
  visited.add(found.real);
  budget.entries += 1;
  if (budget.entries > AGENT_SCAN_MAX_ENTRIES) throw new ScanTooLarge();
  if (found.stat.isFile()) return path.endsWith(".md") ? [path] : [];
  if (!found.stat.isDirectory()) return [];
  if (depth > AGENT_SCAN_MAX_DEPTH) throw new ScanTooLarge();
  const entries = readable(() => readdirSync(path).sort()) ?? [];
  return entries.flatMap((entry) => files(join(path, entry), budget, depth + 1, visited));
}

/** What `read` returns; null when the file or folder is missing or unreadable. */
function readable<T>(read: () => T): null | T {
  try {
    return read();
  } catch {
    // Missing or unreadable: Claude Code cannot load a definition from it either.
    return null;
  }
}

function claiming(paths: string[], name: string, local = true): AgentDefinition | null {
  for (const file of paths) {
    try {
      const header = readFrontmatterHeader(file);
      if (header === null) continue;
      const raw: unknown = Bun.YAML.parse(header);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const fields = raw as Record<string, unknown>;
      if (fields.name !== name) continue;
      // Local skip rules: https://code.claude.com/docs/en/sub-agents#subagent-files-claude-code-skips
      if (
        local &&
        (typeof fields.description !== "string" ||
          name.startsWith("-") ||
          name.includes(":") ||
          name.length > 256)
      )
        continue;
      const model = stringField(fields.model)?.trim() || null;
      return {
        model: model?.toLowerCase() === "inherit" ? null : model,
        effort: stringField(fields.effort)?.trim().toLowerCase() || null,
      };
    } catch {
      // Invalid YAML or a file removed after listing: Claude Code cannot load it either.
    }
  }
  return null;
}

function inside(checkout: string, project: string): boolean {
  const path = relative(resolve(project), resolve(checkout));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * The `.md` files directly in `folder`, symlinks followed. A plugin's `plugin:x` is
 * `agents/x.md` alone: a file in a subfolder registers as `plugin:sub:x`, another name.
 */
function topFiles(folder: string, budget: Budget): string[] {
  const entries = readable(() => readdirSync(folder).sort()) ?? [];
  return entries.flatMap((entry) => {
    budget.entries += 1;
    if (budget.entries > AGENT_SCAN_MAX_ENTRIES) throw new ScanTooLarge();
    const file = join(folder, entry);
    return file.endsWith(".md") && readable(() => statSync(file).isFile()) === true ? [file] : [];
  });
}

function pluginFiles(root: string, budget: Budget): string[] {
  const defaults = topFiles(join(root, "agents"), budget);
  let listed: unknown;
  try {
    listed = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"))?.agents;
  } catch {
    return defaults;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : [];
  if (listed === undefined) return defaults;
  // The manifest replaces the default scan and accepts files only.
  return paths.flatMap((path) => {
    if (typeof path !== "string" || !path.startsWith("./")) return [];
    const file = resolve(root, path);
    if (!inside(file, root)) return [];
    try {
      return statSync(file).isFile() && file.endsWith(".md") ? [file] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The project agents folders, closest first: from the real cwd up to the checkout root. Both
 * are resolved through symlinks, as git names the root, and compared on disk: on Windows the
 * cwd may be spelled with an 8.3 short name where git gives the long one (`isInsideOnDisk`).
 * A cwd whose real folder is outside the checkout scans the checkout root alone. Throws when
 * either folder cannot be resolved.
 */
function projectFolders(checkout: string, cwd: null | string | undefined): string[] {
  const root = realpathSync(checkout);
  const start = realpathSync(cwd ?? checkout);
  const folders: string[] = [];
  let at = isInsideOnDisk(start, root) ? start : root;
  for (;;) {
    folders.push(join(at, ".claude", "agents"));
    const up = dirname(at);
    if (sameFolderOnDisk(at, root) || up === at) return folders;
    at = up;
  }
}

/**
 * Managed, project (closest first), user, then a qualified plugin's or a built-in. Never merges
 * fields across definitions. Null when nothing claims the name, or when a scan passes a cap
 * (`AGENT_SCAN_MAX_DEPTH`, `AGENT_SCAN_MAX_ENTRIES`): a partial scan could miss the definition
 * that wins. Throws when the cwd or the checkout cannot be resolved; the hook refuses then.
 */
export function agentDefinition(name: null | string, place: AgentPlace): AgentDefinition | null {
  try {
    return lookup(name, place, { entries: 0 });
  } catch (error) {
    if (error instanceof ScanTooLarge) return null;
    throw error;
  }
}

function lookup(name: null | string, place: AgentPlace, budget: Budget): AgentDefinition | null {
  if (name === null) return null;
  const colon = name.indexOf(":");
  if (colon === -1) {
    const folders = [
      place.paths.managedAgentsDir,
      ...(place.checkout === null ? [] : projectFolders(place.checkout, place.cwd)),
      join(place.paths.claudeConfigDir, "agents"),
    ];
    for (const folder of folders) {
      const found = claiming(files(folder, budget), name);
      if (found !== null) return found;
    }
  }
  if (colon !== -1) {
    const installs = installsOfPlugin(place.paths.installedPluginsFile, name.slice(0, colon));
    // The cwd as given and as it really is: a symlinked cwd still belongs to its project.
    const given = place.cwd ?? place.checkout;
    const real = given == null ? null : readable(() => realpathSync(given));
    const cwds = [given, real].filter((one): one is string => one != null);
    const project = installs
      .filter(
        (one) =>
          one.scope !== "user" &&
          one.projectPath !== null &&
          cwds.some((cwd) => isInsideOnDisk(cwd, one.projectPath ?? "")),
      )
      .sort((a, b) => (b.projectPath?.length ?? 0) - (a.projectPath?.length ?? 0));
    const root = [...project, ...installs.filter((one) => one.scope === "user")].find((one) =>
      existsSync(one.installPath),
    )?.installPath;
    return root === undefined
      ? null
      : claiming(pluginFiles(root, budget), name.slice(colon + 1), false);
  }
  return Object.hasOwn(BUILT_INS, name)
    ? { model: BUILT_INS[name] ?? null, effort: null, builtIn: true }
    : null;
}
