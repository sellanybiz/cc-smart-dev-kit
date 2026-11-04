import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CliPaths } from "../cli/paths";
import { stringField } from "../hooks/io";
import { installsOfPlugin } from "../setup/installed-plugins";

/** The fields a definition supplies to the launch policy. `inherit` supplies no model. */
export interface AgentDefinition {
  model: null | string;
  effort: null | string;
}

export interface AgentPlace {
  paths: Pick<CliPaths, "home" | "claudeConfigDir" | "installedPluginsFile">;
  checkout: null | string;
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

function files(path: string): string[] {
  try {
    if (statSync(path).isFile()) return path.endsWith(".md") ? [path] : [];
    return readdirSync(path, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) =>
        entry.isDirectory() || entry.isFile() ? files(join(path, entry.name)) : [],
      );
  } catch {
    // A missing/unreadable definition cannot supply fields to the guard.
    return [];
  }
}

function claiming(paths: string[], name: string): AgentDefinition | null {
  for (const file of paths) {
    try {
      const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
      const header = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)?.[1];
      if (header === undefined) continue;
      const raw: unknown = Bun.YAML.parse(header);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const fields = raw as Record<string, unknown>;
      if (fields.name !== name) continue;
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

function pluginFiles(root: string): string[] {
  const defaults = files(join(root, "agents"));
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

/** Project, user, then qualified plugin or built-in. Never merge fields across definitions. */
export function agentDefinition(name: null | string, place: AgentPlace): AgentDefinition | null {
  if (name === null) return null;
  const folders = [
    ...(place.checkout === null ? [] : [join(place.checkout, ".claude", "agents")]),
    join(place.paths.claudeConfigDir, "agents"),
  ];
  for (const folder of folders) {
    const found = claiming(files(folder), name);
    if (found !== null) return found;
  }
  const colon = name.indexOf(":");
  if (colon !== -1) {
    const installs = installsOfPlugin(place.paths.installedPluginsFile, name.slice(0, colon));
    const project = installs
      .filter(
        (one) =>
          one.scope !== "user" &&
          one.projectPath !== null &&
          place.checkout !== null &&
          inside(place.checkout, one.projectPath),
      )
      .sort((a, b) => (b.projectPath?.length ?? 0) - (a.projectPath?.length ?? 0));
    const root = [...project, ...installs.filter((one) => one.scope === "user")].find((one) =>
      existsSync(one.installPath),
    )?.installPath;
    return root === undefined ? null : claiming(pluginFiles(root), name.slice(colon + 1));
  }
  return Object.hasOwn(BUILT_INS, name) ? { model: BUILT_INS[name] ?? null, effort: null } : null;
}
