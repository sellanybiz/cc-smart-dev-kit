/**
 * The plugin's folder, while the portal runs from its copy.
 *
 * The bug this fixes, found live: the child runs from
 * `~/.local/share/cc-smart-dev-kit/portal.js`, so a path made from its own folder resolved
 * `~/.local/plugin` — where there is no `dist/router.js`, no `instructions/` and no
 * `hooks/hooks.json`. "Restart the router" then threw ENOENT, and the Machine page's doctor
 * silently skipped its router-copy check. The folder is now resolved from Claude Code's own
 * record of the installed version, read fresh at each use (an update moves it mid-run), with
 * the folder the parent passed on `--plugin-dir` as the fallback.
 *
 * Every path here is a temp folder; no test reads the real `~/.claude`.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { resolvePluginFolder } from "./plugin-folder";

/** A temp machine with an installed version folder, and the copy the portal runs from. */
function machine(installed: null | string = "0.3.0") {
  const home = tempDir("plugin-folder");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const version = join(
    paths.claudeConfigDir,
    "plugins",
    "cache",
    "cc-smart-dev-kit",
    "cc-smart-dev-kit",
    installed ?? "0.3.0",
  );
  const copy = paths.portalCopy;
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(copy, "// the portal, copied\n");
  return {
    copy,
    /**
     * What the child derives from its own folder when no `--plugin-dir` was passed: the copy
     * sits in `~/.local/share/cc-smart-dev-kit/`, so this is `~/.local/plugin` — the bug.
     */
    besideCopy: join(dirname(copy), "..", "..", "plugin"),
    home,
    /** The folder the parent passes on `--plugin-dir`: the repo's `plugin/`. */
    passed: join(import.meta.dir, "..", "..", "plugin"),
    paths,
    version,
    writeInstalled: (installPath: string) => {
      mkdirSync(join(paths.claudeConfigDir, "plugins"), { recursive: true });
      writeFileSync(
        paths.installedPluginsFile,
        JSON.stringify({
          version: 2,
          plugins: {
            "cc-smart-dev-kit@cc-smart-dev-kit": [
              { gitCommitSha: "abc123", installPath, scope: "user", version: "0.3.0" },
            ],
          },
        }),
      );
    },
  };
}

describe("the plugin's folder while the portal runs", () => {
  test("a copy outside dist/ resolves the version folder Claude Code records, not its own", () => {
    const world = machine();
    mkdirSync(world.version, { recursive: true });
    world.writeInstalled(world.version);
    // The path the child would make from its own folder — the bug — is nowhere near the plugin.
    expect(world.besideCopy).toBe(join(world.home, ".local", "plugin"));
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.passed)).toEqual({
      folder: world.version,
    });
    // And `--plugin-dir` is not preferred over the installed version: an update since the
    // portal started is exactly what the fresh record is for.
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.version)).toEqual({
      folder: world.version,
    });
  });

  test("the record is read at each use: an update during the run moves the folder", () => {
    const world = machine();
    const next = join(dirname(world.version), "0.3.1");
    mkdirSync(world.version, { recursive: true });
    mkdirSync(next, { recursive: true });
    world.writeInstalled(world.version);
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.passed)).toEqual({
      folder: world.version,
    });
    // Claude Code updated the plugin while the portal was open: the version folder it started
    // from is deleted, and the record names the new one.
    rmSync(world.version, { recursive: true });
    world.writeInstalled(next);
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.version)).toEqual({
      folder: next,
    });
  });

  test("no record at all: the folder the parent passed is used while it exists", () => {
    const world = machine();
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.passed)).toEqual({
      folder: world.passed,
    });
    // Run by hand with no `--plugin-dir`: the folder beside the bundle, while it is there.
    mkdirSync(dirname(world.besideCopy), { recursive: true });
    mkdirSync(world.besideCopy, { recursive: true });
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.besideCopy)).toEqual({
      folder: world.besideCopy,
    });
  });

  test("a record whose folder is gone falls back, and with nothing left it says so", () => {
    const world = machine();
    // Half an update: the record names a folder that was already deleted.
    world.writeInstalled(world.version);
    expect(resolvePluginFolder(world.paths.installedPluginsFile, world.passed)).toEqual({
      folder: world.passed,
    });
    // An uninstall: no record, and the parent's folder is gone too.
    rmSync(world.paths.installedPluginsFile);
    const gone = resolvePluginFolder(world.paths.installedPluginsFile, join(world.home, "nowhere"));
    expect("error" in gone).toBe(true);
    expect("error" in gone ? gone.error : "").toContain("the plugin's own folder is gone");
    expect("error" in gone ? gone.error : "").toContain("Stop the portal (Ctrl+C)");
  });
});
