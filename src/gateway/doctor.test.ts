/**
 * `doctor`'s per-project gateway lines against the router that runs (RF1 finding 1): a project
 * whose address names a profile (`…/p/<name>`) fails every request while the running router is an
 * older copy that does not know profiles. After the background self-update the CLI is new while
 * that router stays old until `gateway setup`, so `doctor` says so with its fix.
 *
 * A temp home with the router "installed" (a copy equal to a fake bundle), a config on a port no
 * router uses, a fake `systemctl` runner and a fake health page. Nothing reaches a real port, a
 * real service or a real `~/.claude`.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkLine } from "../cli/doctor";
import { cliPaths } from "../cli/paths";
import { git, tempDir } from "../testing/temp";
import { claudeDefaultsMarkerFile } from "./claude-defaults";
import { DEFAULT_ANTHROPIC_BASE_URL, saveConfig } from "./config";
import { gatewayChecks } from "./doctor";
import type { HealthFetch } from "./health";
import { renderSocket } from "./service";

/** A port no router uses: only the fake health page ever sees it. */
const PORT = 20_997;

/** The health page of the router that runs: this version's lists profiles, a 1.1.x copy's does not. */
function healthOf(router: "current" | "down" | "old"): HealthFetch {
  return async () => {
    if (router === "down") throw new TypeError("Unable to connect");
    return Response.json({
      ...(router === "current" ? { features: ["profiles"] } : {}),
      ok: true,
      port: PORT,
    });
  };
}

/** A temp machine with the router installed and a config that has the profile `team`. */
function machine() {
  const home = tempDir("rf2-doctor");
  const configDir = join(home, ".claude");
  mkdirSync(configDir, { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  const bundle = join(home, "plugin-router.js");
  writeFileSync(bundle, "// the router bundle\n");
  mkdirSync(dirname(paths.routerCopy), { recursive: true });
  writeFileSync(paths.routerCopy, "// the router bundle\n");
  // The socket unit setup writes for this port; the fake runner answers every `systemctl` question.
  mkdirSync(dirname(paths.routerSocketFile), { recursive: true });
  writeFileSync(paths.routerSocketFile, renderSocket(PORT));
  mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
  saveConfig(paths.gatewayConfigFile, {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: {},
    port: PORT,
    profiles: { team: { slots: {} } },
    slots: {},
    timeouts: { firstByteMs: 1000 },
    version: 1,
  });
  return { bundle, home, paths };
}

/** A git project under the temp home's `Code/`, whose personal file holds `url`. */
function project(home: string, label: string, url: string): string {
  const root = join(home, "Code", label);
  mkdirSync(join(root, ".claude"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "app\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "init");
  writeFileSync(
    join(root, ".claude", "settings.local.json"),
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: url } }, null, 2)}\n`,
  );
  return root;
}

/** The lines `doctor` prints for this machine, the router answering as `router` says. */
async function linesFor(
  m: ReturnType<typeof machine>,
  roots: string[],
  router: "current" | "down" | "old",
): Promise<string[]> {
  const checks = await gatewayChecks({
    paths: m.paths,
    bundle: m.bundle,
    runner: () => ({ exitCode: 0, output: "active\n" }),
    service: "systemd",
    fetch: healthOf(router),
    folder: roots[0] ?? m.home,
    projects: async () => ({
      note: null,
      projects: roots.map((root) => ({
        current: root === roots[0],
        name: root.slice(root.lastIndexOf("/") + 1),
        root,
      })),
    }),
  });
  return checks.map(checkLine);
}

describe("doctor: a project on a profile, and the router that runs", () => {
  test("✗ an older router: the project's profile address fails every request", async () => {
    const m = machine();
    const root = project(m.home, "app", `http://127.0.0.1:${PORT}/p/team`);
    const plain = project(m.home, "site", `http://127.0.0.1:${PORT}`);
    const lines = await linesFor(m, [root, plain], "old");
    expect(lines.filter((line) => line.startsWith("✗"))).toEqual([
      `✗ ~/Code/app (here): its address names the profile "team", and the router running on 127.0.0.1:${PORT} is an older copy that does not know profiles, so every request through a profile's address would fail Fix: cc-smart-dev-kit gateway setup`,
    ]);
    // The project's own state line stays, as information.
    expect(lines).toContain(
      `· ~/Code/app (here): on → http://127.0.0.1:${PORT}/p/team  (profile team)  · from the personal file ~/Code/app/.claude/settings.local.json (never committed)`,
    );
  });

  test("this version's router knows profiles: no failure", async () => {
    const m = machine();
    const root = project(m.home, "app", `http://127.0.0.1:${PORT}/p/team`);
    const lines = await linesFor(m, [root], "current");
    expect(lines.filter((line) => line.startsWith("✗"))).toEqual([]);
  });

  test("a router that does not answer is its own ✗: no second guess about profiles", async () => {
    const m = machine();
    const root = project(m.home, "app", `http://127.0.0.1:${PORT}/p/team`);
    const lines = await linesFor(m, [root], "down");
    const failures = lines.filter((line) => line.startsWith("✗"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toStartWith(
      `✗ the socket holds 127.0.0.1:${PORT}, but the router does not answer`,
    );
  });
});

describe("doctor: a linked worktree's own local file (P6, re-proved on 2.1.310)", () => {
  /** The project list holds main roots only (a worktree folds into its main checkout). */
  function withWorktreeFile(m: ReturnType<typeof machine>, body: Record<string, unknown>) {
    const root = project(m.home, "app", `http://127.0.0.1:${PORT}`);
    const worktree = join(m.home, "Code", "app-wt");
    git(root, "worktree", "add", "-q", worktree, "-b", "feat/one");
    mkdirSync(join(worktree, ".claude"), { recursive: true });
    writeFileSync(
      join(worktree, ".claude", "settings.local.json"),
      `${JSON.stringify(body, null, 2)}\n`,
    );
    return root;
  }

  test("! a worktree's copy that holds the router is named, with its fix", async () => {
    const m = machine();
    const root = withWorktreeFile(m, { env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}` } });
    const lines = await linesFor(m, [root], "current");
    expect(lines).toContain(
      `! ~/Code/app-wt/.claude/settings.local.json holds http://127.0.0.1:${PORT}: a session started in that worktree reads it once the root's key is gone (cc-smart-dev-kit never writes or removes this copy) Fix: remove env.ANTHROPIC_BASE_URL from ~/Code/app-wt/.claude/settings.local.json by hand`,
    );
  });

  test("a worktree's file with Anthropic's address, or none, is not named", async () => {
    const m = machine();
    const root = withWorktreeFile(m, { env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL } });
    const lines = await linesFor(m, [root], "current");
    expect(lines.filter((line) => line.includes("app-wt"))).toEqual([]);
  });
});

describe("doctor: a gateway.json from before the Claude defaults (D66)", () => {
  const BEFORE =
    "· gateway.json was made before the Claude defaults (D66): cc-smart-dev-kit setup moves, once, every slot to Claude, every fallback to off and the gateway to off, with a backup of the config first (setup --dry-run shows it)";

  test("the move has not run: setup is named, as information and no failure", async () => {
    const m = machine();
    const lines = await linesFor(m, [], "current");
    expect(lines).toContain(BEFORE);
    expect(lines.filter((line) => line.startsWith("✗"))).toEqual([]);
  });

  test("the move ran (its marker is there): nothing is said", async () => {
    const m = machine();
    mkdirSync(m.paths.stateDir, { recursive: true });
    writeFileSync(claudeDefaultsMarkerFile(m.paths.stateDir), "1.2.0\n");
    const lines = await linesFor(m, [], "current");
    expect(lines.filter((line) => line.includes("Claude defaults"))).toEqual([]);
  });

  test("no gateway.json: nothing to move, nothing said", async () => {
    const m = machine();
    rmSync(m.paths.gatewayConfigFile);
    const lines = await linesFor(m, [], "current");
    expect(lines.filter((line) => line.includes("Claude defaults"))).toEqual([]);
  });
});
