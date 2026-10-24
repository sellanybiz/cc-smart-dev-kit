/**
 * `cc-smart-dev-kit restore` and the MCP servers setup registered: what happens to the record
 * of them when it cannot be read, or when a server cannot be taken back. Run in this process,
 * with a fake `claude` and no router (service "none"); nothing reaches a real tool.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_ANTHROPIC_BASE_URL } from "../gateway/config";
import type { HealthProbe } from "../gateway/health";
import { setGatewayBaseUrl } from "../gateway/settings";
import { CHOICES_FILE, TODO_TOOLS_KEY } from "../machine/claude-mem";
import { takeOver } from "../machine/claude-mem-choices";
import { mcpRecordsFile, recordMcpServer } from "../mcp/records";
import { applyManagedJson } from "../setup/managed-json";
import { writeManagedFile } from "../setup/write";
import { capturePrinted, printed } from "../testing/fake-machine";
import { git, tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { type RestoreOptions, runRestore } from "./restore";

capturePrinted();

/** A probe that is never asked: there is no router here. */
const probe: HealthProbe = {
  fetch: () => Promise.reject(new Error("no router in this test")),
  now: () => 0,
  sleep: () => Promise.resolve(),
};

function machine() {
  const home = tempDir("cli-restore");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  mkdirSync(paths.stateDir, { recursive: true });
  const calls: string[] = [];
  const options = (claudeOk: boolean): RestoreOptions => ({
    yes: true,
    now: false,
    cliBundle: join(home, "plugin", "dist", "cli.js"),
    runner: () => ({ exitCode: 0, output: "" }),
    service: "none",
    confirm: null,
    probe,
    claude: (argv) => {
      calls.push(argv.join(" "));
      return claudeOk ? { ok: true, out: "" } : { ok: false, out: "claude: it failed" };
    },
    which: () => "/usr/bin/claude",
  });
  return { calls, home, options, paths };
}

describe("restore: the record of the MCP servers", () => {
  test("ST-5: a record that cannot be read stays, nothing is removed, and restore fails", async () => {
    const { calls, options, paths } = machine();
    const file = mcpRecordsFile(paths.stateDir);
    writeFileSync(file, "{not json");
    expect(await runRestore(paths, options(true))).toBe(1);
    // The file may still say what setup registered: it is the person's to fix, never deleted.
    expect(readFileSync(file, "utf8")).toBe("{not json");
    expect(calls).toEqual([]);
    expect(printed.join("\n")).toContain(
      "! cannot read ~/.claude/cc-smart-dev-kit/mcp-servers.json (",
    );
    expect(printed.join("\n")).not.toContain("removed (the record of the MCP servers)");
  });

  test("ST-12: a server whose removal failed makes restore fail, and its record stays", async () => {
    const { calls, options, paths } = machine();
    const json = JSON.stringify({ args: ["-y", "a-server@1.0.0"], command: "bunx" });
    recordMcpServer(paths.stateDir, "sequential-thinking", json, "then");
    mkdirSync(dirname(paths.userConfigFile), { recursive: true });
    writeFileSync(
      paths.userConfigFile,
      JSON.stringify({ mcpServers: { "sequential-thinking": JSON.parse(json) } }),
    );
    expect(await runRestore(paths, options(false))).toBe(1);
    expect(calls).toEqual(["claude mcp remove sequential-thinking --scope user"]);
    expect(existsSync(mcpRecordsFile(paths.stateDir))).toBe(true);
    expect(printed.join("\n")).toContain(
      "! $ claude mcp remove sequential-thinking --scope user failed (claude: it failed): the server is still registered",
    );
    // A later restore whose removal works: done, exit 0, and the record goes.
    expect(await runRestore(paths, options(true))).toBe(0);
    expect(existsSync(mcpRecordsFile(paths.stateDir))).toBe(false);
  });
});

describe("restore: claude-mem's keys and the task tools (D23)", () => {
  const WORK_STATE = "CLAUDE_MEM_WORK_STATE_ENABLED";
  const MEMORY = "CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED";

  test("D23: restore takes both start blocks and the task-tools key back, and keeps the rest", async () => {
    const { options, paths } = machine();
    // claude-mem's settings as claude-mem seeds them, then as setup leaves them.
    const file = paths.claudeMemSettingsFile;
    mkdirSync(dirname(file), { recursive: true });
    const seeded = {
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_PROVIDER: "claude",
      [WORK_STATE]: "true",
      [MEMORY]: "true",
    };
    writeFileSync(file, JSON.stringify(seeded, null, 2), { mode: 0o600 });
    applyManagedJson({
      file,
      stateDir: paths.stateDir,
      set: [
        [[WORK_STATE], "false"],
        [[MEMORY], "false"],
      ],
      // claude-mem's own default ("true"): nobody chose it, so setup may take it.
      unchosen: () => true,
    });
    applyManagedJson({
      file: paths.settingsFile,
      stateDir: paths.stateDir,
      set: [[["env", TODO_TOOLS_KEY], "1"]],
    });

    expect(await runRestore(paths, options(true))).toBe(0);
    // The keys go; claude-mem falls back to its own defaults ("true") for both.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_PROVIDER: "claude",
    });
    // setup created the settings file for this one key: restore removes it again.
    expect(existsSync(paths.settingsFile)).toBe(false);
    expect(printed.join("\n")).toContain(
      "~ ~/.claude-mem/settings.json: removed CLAUDE_MEM_WORK_STATE_ENABLED, CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED; everything else kept",
    );
  });
});

describe("restore: a value cc-smart-dev-kit took over (MS1)", () => {
  test("MS1: the value the person had goes back, and a taken-over key stays", async () => {
    const { options, paths } = machine();
    const file = paths.claudeMemSettingsFile;
    mkdirSync(dirname(file), { recursive: true });
    // claude-mem itself, as its own install: the take-over reads its version.
    const installPath = join(paths.home, "plugins", "claude-mem");
    mkdirSync(installPath, { recursive: true });
    mkdirSync(dirname(paths.installedPluginsFile), { recursive: true });
    writeFileSync(
      paths.installedPluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "claude-mem@thedotmack": [{ installPath, scope: "user", version: "13.40.0" }],
        },
      }),
    );
    writeFileSync(
      file,
      JSON.stringify(
        {
          CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
          CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "sk-own-0001",
          CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:18434/v1",
          CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
          CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
          CLAUDE_MEM_PROVIDER: "openai-compatible",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    expect((await takeOver(paths)).ok).toBe(true);
    // The kit changes the model, as a route change would: the value it held stays in the record.
    applyManagedJson({
      file,
      set: [[["CLAUDE_MEM_OPENAI_COMPAT_MODEL"], "glm/flash"]],
      stateDir: paths.stateDir,
    });
    expect(JSON.parse(readFileSync(file, "utf8")).CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("glm/flash");

    expect(await runRestore(paths, options(true))).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8"));
    // The person's own model is back, and so is the rest of what they set.
    expect(after.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("their-model");
    expect(after.CLAUDE_MEM_OPENAI_COMPAT_BASE_URL).toBe("http://127.0.0.1:18434/v1");
    expect(after.CLAUDE_MEM_PROVIDER).toBe("openai-compatible");
    // A key's value is never written down: restore leaves the key exactly as the person set it,
    // and its claim goes. The key is never printed, only that it is theirs again.
    expect(after.CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe("sk-own-0001");
    expect(printed.join("\n")).toContain(
      '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model" (yours again)',
    );
    expect(printed.join("\n")).toContain(
      "~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: yours again (still the key you set)",
    );
    expect(printed.join("\n")).not.toContain("sk-own-0001");
  });
});

describe("restore: claude-mem's choices from the portal (PM1)", () => {
  test("PM1: restore removes the record of the person's portal choices, and says so", async () => {
    const { options, paths } = machine();
    const choices = join(paths.stateDir, CHOICES_FILE);
    writeFileSync(choices, "{}\n", { mode: 0o600 });
    expect(await runRestore(paths, options(true))).toBe(0);
    expect(existsSync(choices)).toBe(false);
    expect(printed.join("\n")).toContain(
      "- ~/.claude/cc-smart-dev-kit/claude-mem-choices.json: removed (your claude-mem choices from the portal; the next setup follows the scout slot again)",
    );
  });
});

describe("restore: a project's gateway key keeps the router up (GP4a)", () => {
  /** A git project under a temp folder with one commit: the personal file's home. */
  function project(label: string): string {
    const root = join(tempDir(label), "app");
    mkdirSync(root, { recursive: true });
    git(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "README.md"), "app\n");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "init");
    return root;
  }

  test("stage 1 counts the kit's gateway keys in every file it wrote, not only the user's settings", async () => {
    const { options, paths } = machine();
    // The router was installed: its copy is one of the kit's managed files, so a restore
    // would stop and remove it.
    writeManagedFile(paths.routerCopy, "// the router\n", {
      stateDir: paths.stateDir,
      kind: "whole-file",
    });
    // A project points at the router in its own personal file. The user's settings hold no
    // gateway key: before GP4a that was the only file the stage asked, so a restore went
    // straight to stage 2 and stopped the router under this project's running sessions.
    const root = project("gp4a-restore");
    const personal = join(root, ".claude", "settings.local.json");
    setGatewayBaseUrl({
      file: personal,
      stateDir: paths.stateDir,
      value: "http://127.0.0.1:20999",
    });

    expect(await runRestore(paths, options(true))).toBe(0);
    // Stage 1 (GP5): the file's address is written to Anthropic's own instead of removed, so
    // the sessions running in that project switch by themselves within about a second. The
    // address key stays (owned), and so does the file the kit created for it; the router stays
    // up until the second run.
    expect(JSON.parse(readFileSync(personal, "utf8"))).toEqual({
      env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL },
    });
    expect(printed.join("\n")).toContain("Every running Claude session switches to Anthropic");
    expect(existsSync(paths.routerCopy)).toBe(true);
    // Stage 2, once that change has had its second: nothing of ours points at the router any
    // more, so the address key is taken back with the rest, and the file goes with its last key.
    expect(await runRestore(paths, options(true))).toBe(0);
    expect(existsSync(personal)).toBe(false);
    expect(existsSync(paths.routerCopy)).toBe(false);
  });

  test("a worktree's copy of the personal file that holds the router is named in both stages, and never changed (P6, 2.1.310)", async () => {
    const { options, paths } = machine();
    writeManagedFile(paths.routerCopy, "// the router\n", {
      stateDir: paths.stateDir,
      kind: "whole-file",
    });
    const root = project("gf1-restore-copy");
    const personal = join(root, ".claude", "settings.local.json");
    setGatewayBaseUrl({
      file: personal,
      stateDir: paths.stateDir,
      value: "http://127.0.0.1:20999",
    });
    // A `.worktreeinclude` copy of that file in a linked worktree: the kit did not write it.
    const worktree = join(tempDir("gf1-restore-copy-wt"), "wt");
    git(root, "worktree", "add", "-q", worktree, "-b", "crew/copy");
    const copy = join(worktree, ".claude", "settings.local.json");
    mkdirSync(dirname(copy), { recursive: true });
    const copyText = `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20999" } }, null, 2)}\n`;
    writeFileSync(copy, copyText);
    const warning = `! ${copy.replace(paths.home, "~")} holds http://127.0.0.1:20999: it is a copy the kit did not write, so restore leaves it, and a session started in that worktree goes to a stopped router once the root's key is gone`;

    // Stage 1 writes Anthropic's address into the root's file, which wins: the copy is named.
    expect(await runRestore(paths, options(true))).toBe(0);
    expect(printed.join("\n")).toContain(warning);
    expect(readFileSync(copy, "utf8")).toBe(copyText);

    // Stage 2 removes the root's key and stops the router: the copy is named again, before.
    printed.length = 0;
    expect(await runRestore(paths, options(true))).toBe(0);
    expect(printed.join("\n")).toContain(warning);
    expect(readFileSync(copy, "utf8")).toBe(copyText);
  });

  test("a project set to off does not keep the router up: one pass, and no restart line", async () => {
    const { options, paths } = machine();
    writeManagedFile(paths.routerCopy, "// the router\n", {
      stateDir: paths.stateDir,
      kind: "whole-file",
    });
    // `gateway project off` writes Anthropic's own address as a key of ours. A session there
    // goes to Anthropic on the person's own login, so the router may stop at once — the words
    // "they still use the router" would be untrue for this key (review finding, GP4a).
    const root = project("gp4a-restore-off");
    const personal = join(root, ".claude", "settings.local.json");
    setGatewayBaseUrl({
      file: personal,
      stateDir: paths.stateDir,
      value: "https://api.anthropic.com",
    });

    expect(await runRestore(paths, options(true))).toBe(0);
    expect(existsSync(paths.routerCopy)).toBe(false);
    // Nothing switches here: no session of that project ever pointed at the router once the
    // project was off with Anthropic's own address (GP4a), and stage 1 has nothing to write.
    expect(printed.join("\n")).not.toContain("switches to Anthropic by itself");
  });
});
