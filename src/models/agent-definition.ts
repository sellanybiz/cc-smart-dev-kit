import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CliPaths } from "../cli/paths";
import { stringField } from "../hooks/io";
import { hostPlatform } from "../machine/host";
import { installsOfPlugin } from "../setup/installed-plugins";

/** The fields a definition supplies to the launch policy. `inherit` supplies no model. */
export interface AgentDefinition {
  model: null | string;
  effort: null | string;
}

export interface AgentPlace {
  paths: Pick<CliPaths, "home" | "claudeConfigDir" | "installedPluginsFile">;
  checkout: null | string;
  cwd?: null | string;
  managedAgentsDir?: string;
}

/** Paths and priority: https://code.claude.com/docs/en/sub-agents and
 * https://code.claude.com/docs/en/managed-settings#delivery-mechanisms (2026-11-05). */
export function managedAgentsDir(platform = hostPlatform()): string {
  const root =
    platform === "darwin"
      ? "/Library/Application Support/ClaudeCode"
      : platform === "win32"
        ? "C:\\Program Files\\ClaudeCode"
        : "/etc/claude-code";
  return join(root, ".claude", "agents");
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

function files(path: string, visited = new Set<string>()): string[] {
  try {
    const real = realpathSync(path);
    if (visited.has(real)) return [];
    visited.add(real);
    const stat = statSync(path);
    if (stat.isFile()) return path.endsWith(".md") ? [path] : [];
    if (!stat.isDirectory()) return [];
    return readdirSync(path)
      .sort()
      .flatMap((entry) => files(join(path, entry), visited));
  } catch {
    // A missing/unreadable definition cannot supply fields to the guard.
    return [];
  }
}

/** Read through the frontmatter closing line, never the agent's body. */
function frontmatter(file: string): string | null {
  const fd = openSync(file, "r");
  try {
    const byte = Buffer.alloc(1);
    const lines: string[] = [];
    let line = "";
    let opened = false;
    while (readSync(fd, byte, 0, 1, null) !== 0) {
      if (byte[0] !== 10) {
        line += byte.toString("latin1");
        continue;
      }
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!opened) {
        if (normalized !== "---") return null;
        opened = true;
      } else if (normalized === "---") {
        return Buffer.from(lines.join("\n"), "latin1").toString("utf8");
      } else {
        lines.push(normalized);
      }
      line = "";
    }
    return opened && line === "---"
      ? Buffer.from(lines.join("\n"), "latin1").toString("utf8")
      : null;
  } finally {
    closeSync(fd);
  }
}

function claiming(paths: string[], name: string, local = true): AgentDefinition | null {
  for (const file of paths) {
    try {
      const header = frontmatter(file);
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
  const colon = name.indexOf(":");
  if (colon === -1) {
    const folders = [place.managedAgentsDir ?? managedAgentsDir()];
    if (place.checkout !== null) {
      let at = resolve(place.cwd ?? place.checkout);
      while (inside(at, place.checkout)) {
        folders.push(join(at, ".claude", "agents"));
        if (at === resolve(place.checkout)) break;
        at = dirname(at);
      }
    }
    folders.push(join(place.paths.claudeConfigDir, "agents"));
    for (const folder of folders) {
      const found = claiming(files(folder), name);
      if (found !== null) return found;
    }
  }
  if (colon !== -1) {
    const installs = installsOfPlugin(place.paths.installedPluginsFile, name.slice(0, colon));
    const project = installs
      .filter(
        (one) =>
          one.scope !== "user" &&
          one.projectPath !== null &&
          (place.cwd ?? place.checkout) != null &&
          inside(place.cwd ?? place.checkout ?? "", one.projectPath),
      )
      .sort((a, b) => (b.projectPath?.length ?? 0) - (a.projectPath?.length ?? 0));
    const root = [...project, ...installs.filter((one) => one.scope === "user")].find((one) =>
      existsSync(one.installPath),
    )?.installPath;
    return root === undefined ? null : claiming(pluginFiles(root), name.slice(colon + 1), false);
  }
  return Object.hasOwn(BUILT_INS, name) ? { model: BUILT_INS[name] ?? null, effort: null } : null;
}
