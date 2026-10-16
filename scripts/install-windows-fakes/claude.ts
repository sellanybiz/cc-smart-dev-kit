/**
 * The fake `claude` for the Windows smoke test (`scripts/install-windows-smoke.ps1`) and for
 * the Linux test of the fakes themselves (`scripts/install.test.ts`): it logs every argument
 * and answers the plugin commands the installer runs, writing the same records Claude Code
 * writes (docs/claude-code-contract.md).
 *
 * It is a `.ts` file run by the real `bun.exe` through a one-line `.cmd` wrapper. That is
 * deliberate: batch's own argument parsing and delayed expansion are where the first Windows
 * run of 0.4.2 broke, and a fake whose logic is TypeScript can be exercised on Linux before
 * it reaches a Windows runner — which is what the test does.
 *
 * Every command takes a `Context` (`contextFromEnv` builds the one the smoke test uses), so a
 * test can point one at a world of its own.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** What this fake reads from the environment the smoke test builds. */
export interface Context {
  configDir: string;
  log: string;
  version: string;
}

/** Where each marketplace's source lands, by the name Claude Code gives the marketplace. */
export const MARKETPLACE_NAMES: Record<string, string> = {
  "anthropics/claude-plugins-official": "claude-plugins-official",
  "thedotmack/claude-mem": "thedotmack",
};

export function contextFromEnv(): Context {
  return {
    configDir: process.env.CLAUDE_CONFIG_DIR ?? "",
    log: process.env.FAKE_LOG ?? "",
    version: process.env.FAKE_MARKETPLACE_VERSION ?? "0.4.2",
  };
}

function record(context: Context, line: string): void {
  if (context.log !== "") appendFileSync(context.log, `${line}\n`);
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const knownFile = (context: Context): string =>
  join(context.configDir, "plugins", "known_marketplaces.json");
const installedFile = (context: Context): string =>
  join(context.configDir, "plugins", "installed_plugins.json");
const settingsFile = (context: Context): string => join(context.configDir, "settings.json");

/** The marketplace's own name for a source: this repository's is the default. */
export function marketplaceNameFor(source: string): string {
  return MARKETPLACE_NAMES[source] ?? "cc-smart-dev-kit";
}

function marketplaceAdd(context: Context, source: string): void {
  const name = marketplaceNameFor(source);
  const dir = join(context.configDir, "plugins", "marketplaces", name);
  mkdirSync(join(dir, "plugin", ".claude-plugin"), { recursive: true });
  if (name === "cc-smart-dev-kit") {
    writeJson(join(dir, "plugin", ".claude-plugin", "plugin.json"), {
      name: "cc-smart-dev-kit",
      version: context.version,
    });
  }
  const known = readJson(knownFile(context));
  known[name] = { source: { source: "github", repo: source }, installLocation: dir };
  writeJson(knownFile(context), known);
}

function marketplaceRemove(context: Context, name: string): void {
  const known = readJson(knownFile(context));
  delete known[name];
  writeJson(knownFile(context), known);
}

function pluginEnable(context: Context): void {
  const settings = readJson(settingsFile(context));
  const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
  enabled["cc-smart-dev-kit@cc-smart-dev-kit"] = true;
  settings.enabledPlugins = enabled;
  writeJson(settingsFile(context), settings);
}

/** `plugin install` and `plugin update` leave the same records behind. */
function pluginRecord(context: Context): void {
  const dir = join(
    context.configDir,
    "plugins",
    "cache",
    "cc-smart-dev-kit",
    "cc-smart-dev-kit",
    context.version,
  );
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "cli.js"), 'await import("the plugin");\n');
  writeFileSync(join(dir, "bunfig.toml"), "{}\n");
  const installed = readJson(installedFile(context));
  installed.version = 2;
  const plugins = (installed.plugins ?? {}) as Record<string, unknown>;
  plugins["cc-smart-dev-kit@cc-smart-dev-kit"] = [
    { scope: "user", installPath: dir, version: context.version },
  ];
  installed.plugins = plugins;
  writeJson(installedFile(context), installed);
  pluginEnable(context);
}

function pluginUninstall(context: Context, id: string): void {
  const installed = readJson(installedFile(context));
  const plugins = (installed.plugins ?? {}) as Record<string, unknown>;
  delete plugins[id];
  installed.plugins = plugins;
  writeJson(installedFile(context), installed);
}

/** What the fake answers: it logs the call, then does what Claude Code would do. */
export function answer(argv: string[], context: Context): void {
  record(context, `claude ${argv.join(" ")}`);
  const [plugin, command, third, fourth] = argv;
  if (plugin !== "plugin") return;
  if (command === "marketplace" && third === "add" && fourth !== undefined) {
    marketplaceAdd(context, fourth);
    return;
  }
  if (command === "marketplace" && third === "remove" && fourth !== undefined) {
    marketplaceRemove(context, fourth);
    return;
  }
  if (command === "install" || command === "update") {
    pluginRecord(context);
    return;
  }
  if (command === "enable") {
    pluginEnable(context);
    return;
  }
  if (command === "uninstall" && third !== undefined) pluginUninstall(context, third);
}

if (import.meta.main) {
  answer(process.argv.slice(2), contextFromEnv());
}
