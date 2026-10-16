/**
 * The MCP servers (`servers.ts`, `records.ts`, `register.ts`): the registrations
 * cc-smart-dev-kit writes at user scope, and taking exactly those back.
 *
 * `claude mcp …` is Claude Code's own command, so every case here runs a fake `claude` that
 * records its calls: what matters is which commands setup runs, never what it holds itself.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { mcpChecks } from "./doctor";
import { markMcpServerPending, readMcpRecords, recordMcpServer } from "./records";
import {
  applyMcpServers,
  type ClaudeRun,
  overridingServer,
  planMcpServers,
  readUserServers,
  recordApplied,
  removeMcpServers,
  sameConfig,
  unreadableUserConfigNote,
} from "./register";
import {
  installSerenaContext,
  removeSerenaContext,
  serenaContextCurrent,
  serenaContextSource,
} from "./serena-context";
import { mcpServers, serenaArgs } from "./servers";
import { describeServerConfig, mcpServerStatus, mcpServerStatusLine } from "./status";
import { readTavilyKey } from "./tavily";
import { MCP_VERSIONS, TAVILY_MCP_URL } from "./versions";

function paths(home: string) {
  return cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
}

/** A fake `claude`: it records the calls, and writes the user config the way Claude Code does. */
function fakeClaude(home: string) {
  const paths_ = paths(home);
  const calls: string[][] = [];
  const run: ClaudeRun = (argv) => {
    calls.push(argv);
    const [, , verb, ...rest] = argv;
    const all = readUserServers(paths_.userConfigFile) ?? {};
    if (verb === "add-json") {
      const name = rest[rest.length - 2] ?? "";
      const json = rest[rest.length - 1] ?? "";
      if (all[name] !== undefined) {
        return { ok: false, out: `MCP server ${name} already exists in user config` };
      }
      mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
      writeFileSync(
        paths_.userConfigFile,
        JSON.stringify({ mcpServers: { ...all, [name]: JSON.parse(json) } }),
      );
      return { ok: true, out: "" };
    }
    if (verb === "remove") {
      const name = rest[0] ?? "";
      delete all[name];
      writeFileSync(paths_.userConfigFile, JSON.stringify({ mcpServers: all }));
      return { ok: true, out: "" };
    }
    return { ok: false, out: `unexpected: ${argv.join(" ")}` };
  };
  return { calls, run, paths: paths_ };
}

const context = (home: string) => ({
  bunx: "bunx",
  launcher: join(home, ".local", "bin", "cc-smart-dev-kit"),
  serenaContextFile: join(home, "serena", "worktree.yml"),
  tavily: { key: true } as const,
});

/**
 * `applyMcpServers`'s `markPending` for the tests that do not watch the pending mark. The
 * tests that do pass their own, and read the record file inside the fake `claude`.
 */
const noPending = (): void => {};

/** Windows makes the modes up (`statSync().mode` is 0666 for a writable file): POSIX assertions. */
const NO_POSIX_MODES = process.platform === "win32";

describe("the servers the plugin registers", () => {
  test("the four general servers, pinned and at user scope; the browser runs the launcher", () => {
    const home = tempDir("mcp-servers");
    const servers = mcpServers(context(home));
    expect(servers.map((server) => server.name)).toEqual([
      "playwright",
      "serena",
      "sequential-thinking",
      "tavily-websearch",
    ]);
    expect(JSON.parse(servers[0]?.json ?? "{}")).toEqual({
      args: ["browser", "mcp"],
      command: join(home, ".local", "bin", "cc-smart-dev-kit"),
    });
    // Serena: the pinned commit, and the plugin's own context (project switching on).
    expect(serenaArgs("/data/worktree.yml")).toEqual([
      "--from",
      `git+https://github.com/oraios/serena@${MCP_VERSIONS.serena}`,
      "serena",
      "start-mcp-server",
      "--context",
      "/data/worktree.yml",
      "--open-web-dashboard",
      "False",
      "--project-from-cwd",
    ]);
    expect(JSON.parse(servers[2]?.json ?? "{}")).toEqual({
      args: [
        "-y",
        `@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}`,
      ],
      command: "bunx",
    });
    // Tavily: the key is a placeholder Claude Code fills in; no key is written anywhere.
    expect(JSON.parse(servers[3]?.json ?? "{}")).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder.
      headers: { Authorization: "Bearer ${TAVILY_API_KEY}" },
      timeout: 300_000,
      type: "http",
      url: TAVILY_MCP_URL,
    });
    expect(servers[3]?.json).not.toContain("tvly-");
  });

  test("no Tavily key: it is skipped, with a note, and never registered", () => {
    const home = tempDir("mcp-servers");
    const servers = mcpServers({
      ...context(home),
      tavily: { key: false, reason: "no TAVILY_API_KEY in the environment, and no key file" },
    });
    const tavily = servers[3];
    expect(tavily?.json).toBe("");
    // The note setup prints carries the reason, so a person reads what to do.
    expect(tavily?.skipped).toBe("no TAVILY_API_KEY in the environment, and no key file");
  });
});

describe("what setup registers, and what it leaves alone", () => {
  test("nothing registered yet: every server is added, and recorded", () => {
    const home = tempDir("mcp-register");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const plan = planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile));
    expect(plan.map((entry) => entry.action)).toEqual(["add", "add", "add", "add"]);

    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(applied.ok).toBe(true);
    expect(applied.changes).toEqual([
      "+ MCP server playwright registered for your user",
      "+ MCP server serena registered for your user",
      "+ MCP server sequential-thinking registered for your user",
      "+ MCP server tavily-websearch registered for your user",
    ]);
    recordApplied(fake.paths.stateDir, applied, "2026-10-16T00:00:00.000Z");
    expect(readMcpRecords(fake.paths.stateDir)).toEqual({
      playwright: { at: "2026-10-16T00:00:00.000Z", json: servers[0]?.json ?? "" },
      serena: { at: "2026-10-16T00:00:00.000Z", json: servers[1]?.json ?? "" },
      "sequential-thinking": { at: "2026-10-16T00:00:00.000Z", json: servers[2]?.json ?? "" },
      "tavily-websearch": { at: "2026-10-16T00:00:00.000Z", json: servers[3]?.json ?? "" },
    });
    // The commands ran remove-then-add for nobody: first registrations are one command each.
    expect(fake.calls.map((argv) => argv.join(" "))).toEqual([
      `claude mcp add-json --scope user playwright ${servers[0]?.json ?? ""}`,
      `claude mcp add-json --scope user serena ${servers[1]?.json ?? ""}`,
      `claude mcp add-json --scope user sequential-thinking ${servers[2]?.json ?? ""}`,
      `claude mcp add-json --scope user tavily-websearch ${servers[3]?.json ?? ""}`,
    ]);

    // A second setup: nothing to do.
    const again = planMcpServers(
      servers,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(again.map((entry) => entry.action)).toEqual(["keep", "keep", "keep", "keep"]);
    expect(
      applyMcpServers(again, fake.run, () => "/usr/bin/claude", false, noPending).changes,
    ).toEqual([]);
  });

  test("a new pin: the server is removed and added again (add-json refuses a name that exists)", () => {
    const home = tempDir("mcp-register");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const first = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, first, "2026-10-16T00:00:00.000Z");

    // The pin moved: the same names, another JSON.
    const moved = servers.map((server) =>
      server.name === "sequential-thinking"
        ? { ...server, json: JSON.stringify({ args: ["-y", "...@2.0.0"], command: "bunx" }) }
        : server,
    );
    const plan = planMcpServers(
      moved,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[2]?.action).toBe("update");
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(applied.changes).toEqual(["~ MCP server sequential-thinking updated for your user"]);
    expect(
      sameConfig(
        moved[2]?.json ?? "",
        readUserServers(fake.paths.userConfigFile)?.["sequential-thinking"],
      ),
    ).toBe(true);
  });

  test("a server of the person's own is left alone, with a note", () => {
    const home = tempDir("mcp-register");
    const fake = fakeClaude(home);
    mkdirSync(dirname(fake.paths.userConfigFile), { recursive: true });
    writeFileSync(
      fake.paths.userConfigFile,
      JSON.stringify({ mcpServers: { playwright: { args: [], command: "/opt/their-own" } } }),
    );
    const plan = planMcpServers(
      mcpServers(context(home)),
      {},
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[0]?.action).toBe("foreign");
    expect(plan[0]?.note).toContain("registered already, and not by cc-smart-dev-kit: left alone");
    // The three others are registered as usual; the person's own `playwright` is untouched.
    expect(
      applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending).changes,
    ).toEqual([
      "+ MCP server serena registered for your user",
      "+ MCP server sequential-thinking registered for your user",
      "+ MCP server tavily-websearch registered for your user",
    ]);
    expect(readUserServers(fake.paths.userConfigFile)?.playwright).toEqual({
      args: [],
      command: "/opt/their-own",
    });
  });

  test("a server cc-smart-dev-kit registered and the person re-pointed: theirs, and no longer managed", () => {
    const home = tempDir("mcp-register");
    const fake = fakeClaude(home);
    recordMcpServer(fake.paths.stateDir, "playwright", JSON.stringify({ command: "ours" }), "then");
    mkdirSync(dirname(fake.paths.userConfigFile), { recursive: true });
    writeFileSync(
      fake.paths.userConfigFile,
      JSON.stringify({ mcpServers: { playwright: { command: "theirs" } } }),
    );
    const plan = planMcpServers(
      mcpServers(context(home)),
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[0]?.action).toBe("foreign");
    expect(plan[0]?.note).toContain("no longer managed (restore keeps it)");
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    recordApplied(fake.paths.stateDir, applied, "now");
    expect(readMcpRecords(fake.paths.stateDir).playwright).toBeUndefined();
  });

  test("without claude on PATH: nothing runs, and setup says so", () => {
    const home = tempDir("mcp-register");
    const fake = fakeClaude(home);
    const plan = planMcpServers(
      mcpServers(context(home)),
      {},
      readUserServers(fake.paths.userConfigFile),
    );
    const applied = applyMcpServers(plan, fake.run, () => null, false, noPending);
    expect(applied.ok).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(applied.notes[0]).toBe(
      "! The claude command is not on PATH, so playwright was not registered. Run it once it is.",
    );
  });

  test("a dry run prints the commands and runs none", () => {
    const home = tempDir("mcp-register");
    const fake = fakeClaude(home);
    const plan = planMcpServers(
      mcpServers(context(home)),
      {},
      readUserServers(fake.paths.userConfigFile),
    );
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", true, noPending);
    expect(applied.wouldRun[0]).toBe(
      `$ claude mcp add-json --scope user playwright ${mcpServers(context(home))[0]?.json ?? ""}`,
    );
    expect(fake.calls).toEqual([]);
    expect(applied.registered).toEqual([]);
  });

  test("an unreadable Claude Code config: nothing runs, every record stays, one line says so", () => {
    const home = tempDir("mcp-unreadable");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const applied = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, applied, "then");
    const records = readMcpRecords(fake.paths.stateDir);
    // Claude Code's file is there, but does not read: a half-written one.
    writeFileSync(fake.paths.userConfigFile, "{ half a file");
    const callsBefore = fake.calls.length;

    const live = readUserServers(fake.paths.userConfigFile);
    expect(live).toBeNull();
    const plan = planMcpServers(servers, records, live);
    expect(plan.map((entry) => entry.action)).toEqual(["keep", "keep", "keep", "keep"]);
    expect(plan.every((entry) => entry.forget === undefined)).toBe(true);
    const again = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(again.changes).toEqual([]);
    expect(again.forgotten).toEqual([]);
    expect(again.registered).toEqual([]);
    expect(fake.calls).toHaveLength(callsBefore);
    recordApplied(fake.paths.stateDir, again, "later");
    expect(readMcpRecords(fake.paths.stateDir)).toEqual(records);
    // The one line the caller prints, with every kept name.
    expect(unreadableUserConfigNote("~/.claude.json", Object.keys(records))).toBe(
      "! cannot read ~/.claude.json: nothing changed — the MCP servers cc-smart-dev-kit registered stay as they are: playwright, sequential-thinking, serena, tavily-websearch",
    );
  });

  test("an update marks the record pending before its remove, and clears it after its add", () => {
    const home = tempDir("mcp-pending");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const first = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, first, "then");
    // The pin moved: sequential-thinking's JSON changed.
    const moved = servers.map((server) =>
      server.name === "sequential-thinking"
        ? { ...server, json: JSON.stringify({ args: ["-y", "...@2.0.0"], command: "bunx" }) }
        : server,
    );
    const seen: (boolean | undefined)[] = [];
    const run: ClaudeRun = (argv) => {
      const record = () => readMcpRecords(fake.paths.stateDir)["sequential-thinking"]?.pending;
      if (argv[2] === "remove" && argv[3] === "sequential-thinking") seen.push(record());
      const outcome = fake.run(argv);
      if (argv[2] === "add-json" && argv[5] === "sequential-thinking") seen.push(record());
      return outcome;
    };
    const plan = planMcpServers(
      moved,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[2]?.action).toBe("update");
    const applied = applyMcpServers(
      plan,
      run,
      () => "/usr/bin/claude",
      false,
      (name) => {
        markMcpServerPending(fake.paths.stateDir, name);
      },
    );
    // Pending while the remove runs AND while the add runs: the mark is written before the
    // remove, and cleared only after the add.
    expect(seen).toEqual([true, true]);
    recordApplied(fake.paths.stateDir, applied, "later");
    expect(readMcpRecords(fake.paths.stateDir)["sequential-thinking"]).toEqual({
      at: "later",
      json: moved[2]?.json ?? "",
    });
  });

  test("a record still pending, its server gone: setup finishes its own update", () => {
    const home = tempDir("mcp-pending");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const first = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, first, "then");
    // An update whose remove ran, then the process died before the add.
    markMcpServerPending(fake.paths.stateDir, "playwright");
    const live = readUserServers(fake.paths.userConfigFile) ?? {};
    delete live.playwright;
    writeFileSync(fake.paths.userConfigFile, JSON.stringify({ mcpServers: live }));

    const plan = planMcpServers(
      servers,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[0]?.action).toBe("add");
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(applied.changes).toEqual(["+ MCP server playwright registered for your user"]);
    expect(readUserServers(fake.paths.userConfigFile)?.playwright).toEqual(
      JSON.parse(servers[0]?.json ?? "{}"),
    );
    recordApplied(fake.paths.stateDir, applied, "later");
    expect(readMcpRecords(fake.paths.stateDir).playwright).toEqual({
      at: "later",
      json: servers[0]?.json ?? "",
    });
  });

  test("a server the person removed: the record goes, nothing runs, one line adds it back", () => {
    const home = tempDir("mcp-removed");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const first = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, first, "then");
    const live = readUserServers(fake.paths.userConfigFile) ?? {};
    delete live.playwright;
    writeFileSync(fake.paths.userConfigFile, JSON.stringify({ mcpServers: live }));
    const callsBefore = fake.calls.length;

    const plan = planMcpServers(
      servers,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[0]?.action).toBe("gone");
    expect(plan[0]?.forget).toBe(true);
    expect(plan[0]?.note).toBe(
      "· MCP server playwright is not registered any more: the record was forgotten. " +
        `To add it back: claude mcp add-json --scope user playwright '${servers[0]?.json ?? ""}'`,
    );
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(applied.changes).toEqual([]);
    expect(applied.forgotten).toEqual(["playwright"]);
    expect(fake.calls).toHaveLength(callsBefore);
    recordApplied(fake.paths.stateDir, applied, "later");
    expect(readMcpRecords(fake.paths.stateDir).playwright).toBeUndefined();
  });

  test("a pending update whose add DID land: kept, and the mark cleared", () => {
    const home = tempDir("mcp-pending");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const first = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, first, "then");
    const moved = servers.map((server) =>
      server.name === "sequential-thinking"
        ? { ...server, json: JSON.stringify({ args: ["-y", "...@2.0.0"], command: "bunx" }) }
        : server,
    );
    markMcpServerPending(fake.paths.stateDir, "sequential-thinking");
    // The add ran, the process died before the record was written.
    const live = readUserServers(fake.paths.userConfigFile) ?? {};
    writeFileSync(
      fake.paths.userConfigFile,
      JSON.stringify({
        mcpServers: { ...live, "sequential-thinking": JSON.parse(moved[2]?.json ?? "{}") },
      }),
    );

    const plan = planMcpServers(
      moved,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[2]?.action).toBe("keep");
    expect(plan[2]?.clearPending).toBe(true);
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(applied.changes).toEqual([]);
    recordApplied(fake.paths.stateDir, applied, "later");
    expect(readMcpRecords(fake.paths.stateDir)["sequential-thinking"]).toEqual({
      at: "later",
      json: moved[2]?.json ?? "",
    });
  });

  test("no Tavily key now: a recorded server of ours is taken back", () => {
    const home = tempDir("mcp-tavily");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const first = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, first, "then");

    const withoutKey = servers.map((server) =>
      server.name === "tavily-websearch"
        ? {
            json: "",
            name: server.name,
            skipped: "no TAVILY_API_KEY in the environment, and no key file",
          }
        : server,
    );
    const plan = planMcpServers(
      withoutKey,
      readMcpRecords(fake.paths.stateDir),
      readUserServers(fake.paths.userConfigFile),
    );
    expect(plan[3]?.action).toBe("remove");
    const applied = applyMcpServers(plan, fake.run, () => "/usr/bin/claude", false, noPending);
    expect(applied.changes).toEqual([
      "- MCP server tavily-websearch removed from your user config",
    ]);
    expect(applied.notes).toEqual([
      "! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, and no key file",
    ]);
    recordApplied(fake.paths.stateDir, applied, "later");
    expect(readUserServers(fake.paths.userConfigFile)?.["tavily-websearch"]).toBeUndefined();
    expect(readMcpRecords(fake.paths.stateDir)["tavily-websearch"]).toBeUndefined();
  });
});

describe("restore: exactly what setup registered", () => {
  test("our servers go; one the person re-pointed stays; the record follows", () => {
    const home = tempDir("mcp-restore");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const applied = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, applied, "then");
    // The person re-points one of them (serena) at something of their own.
    const live = readUserServers(fake.paths.userConfigFile) ?? {};
    writeFileSync(
      fake.paths.userConfigFile,
      JSON.stringify({ mcpServers: { ...live, serena: { command: "/opt/theirs" } } }),
    );

    const removal = removeMcpServers(fake.paths, fake.run, () => "/usr/bin/claude", false);
    expect(removal.removed).toEqual([
      "- MCP server playwright removed from your user config",
      "- MCP server sequential-thinking removed from your user config",
      "- MCP server tavily-websearch removed from your user config",
    ]);
    expect(removal.notes).toEqual([
      "  MCP server serena holds a config cc-smart-dev-kit did not write: left alone (it is yours now)",
    ]);
    expect(removal.forgotten.sort()).toEqual([
      "playwright",
      "sequential-thinking",
      "serena",
      "tavily-websearch",
    ]);
    expect(readUserServers(fake.paths.userConfigFile)).toEqual({
      serena: { command: "/opt/theirs" },
    });
  });

  test("without claude on PATH: the record stays, so a later restore tries again", () => {
    const home = tempDir("mcp-restore");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const applied = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, applied, "then");
    const removal = removeMcpServers(fake.paths, fake.run, () => null, false);
    expect(removal.removed).toEqual([]);
    expect(removal.kept).toHaveLength(4);
    expect(removal.notes[0]).toContain("The claude command is not on PATH");
    expect(Object.keys(readMcpRecords(fake.paths.stateDir))).toHaveLength(4);
  });

  test("nothing of ours is registered: nothing to do, and no command runs", () => {
    const home = tempDir("mcp-restore");
    const fake = fakeClaude(home);
    const removal = removeMcpServers(fake.paths, fake.run, () => "/usr/bin/claude", false);
    expect(removal).toEqual({ forgotten: [], kept: [], notes: [], removed: [], wouldRun: [] });
    expect(fake.calls).toEqual([]);
    expect(existsSync(fake.paths.userConfigFile)).toBe(false);
  });

  test("an unreadable Claude Code config: nothing is removed, and every record stays", () => {
    const home = tempDir("mcp-restore-unreadable");
    const fake = fakeClaude(home);
    const servers = mcpServers(context(home));
    const applied = applyMcpServers(
      planMcpServers(servers, {}, readUserServers(fake.paths.userConfigFile)),
      fake.run,
      () => "/usr/bin/claude",
      false,
      noPending,
    );
    recordApplied(fake.paths.stateDir, applied, "then");
    writeFileSync(fake.paths.userConfigFile, "{ half a file");
    const callsBefore = fake.calls.length;

    const removal = removeMcpServers(fake.paths, fake.run, () => "/usr/bin/claude", false);
    expect(removal.removed).toEqual([]);
    expect(removal.forgotten).toEqual([]);
    expect(removal.kept).toEqual([
      "playwright",
      "sequential-thinking",
      "serena",
      "tavily-websearch",
    ]);
    // `~` and then the platform's own separators: `~\.claude\.claude.json` on Windows.
    expect(removal.notes).toEqual([
      `! cannot read ${join("~", ".claude", ".claude.json")}: nothing changed — the MCP servers cc-smart-dev-kit registered stay as they are: playwright, sequential-thinking, serena, tavily-websearch`,
    ]);
    expect(fake.calls).toHaveLength(callsBefore);
    expect(Object.keys(readMcpRecords(fake.paths.stateDir))).toHaveLength(4);
  });
});

describe("the Tavily key", () => {
  test("the environment already has it: setup writes nothing", () => {
    const home = tempDir("mcp-tavily");
    expect(readTavilyKey(paths(home), { TAVILY_API_KEY: "tvly-from-the-environment" })).toEqual({
      source: "environment",
    });
  });

  test("the key file (0600): the key is used, and never printed by the reason", () => {
    const home = tempDir("mcp-tavily");
    const paths_ = paths(home);
    mkdirSync(dirname(paths_.tavilyKeyFile), { recursive: true });
    writeFileSync(paths_.tavilyKeyFile, "tvly-secret\n", { mode: 0o600 });
    const key = readTavilyKey(paths_, {});
    expect(key).toEqual({ source: "file", value: "tvly-secret" });
    expect(JSON.stringify(key)).not.toContain("readable by others");
  });

  test.skipIf(NO_POSIX_MODES)(
    "a key file others can read is refused, naming the file and never its content",
    () => {
      const home = tempDir("mcp-tavily");
      const paths_ = paths(home);
      mkdirSync(dirname(paths_.tavilyKeyFile), { recursive: true });
      writeFileSync(paths_.tavilyKeyFile, "tvly-exposed\n", { mode: 0o644 });
      const key = readTavilyKey(paths_, {});
      expect(key.source).toBe("none");
      expect(key.source === "none" ? key.reason : "").toContain("readable by others (mode 644)");
      expect(key.source === "none" ? key.reason : "").not.toContain("tvly-exposed");
    },
  );

  test("the same shared-looking key file: refused off Windows, used on Windows", () => {
    // Windows reports 0o100666 for a writable file whatever its ACL says, so the bits cannot
    // decide there: refusing every file would leave every Windows machine without a Tavily
    // server, over a file the profile's ACL already keeps to its owner.
    const home = tempDir("mcp-tavily");
    const paths_ = paths(home);
    mkdirSync(dirname(paths_.tavilyKeyFile), { recursive: true });
    writeFileSync(paths_.tavilyKeyFile, "tvly-exposed\n", { mode: 0o666 });
    expect(readTavilyKey(paths_, {}, "linux").source).toBe("none");
    expect(readTavilyKey(paths_, {}, "win32")).toEqual({ source: "file", value: "tvly-exposed" });
  });

  test("an empty file, and no file at all: a reason that says what to do", () => {
    const home = tempDir("mcp-tavily");
    const paths_ = paths(home);
    const missing = readTavilyKey(paths_, {});
    expect(missing.source).toBe("none");
    expect(missing.source === "none" ? missing.reason : "").toContain(
      "no TAVILY_API_KEY in the environment, in the settings, or in a key file",
    );
    // No `chmod 600` on Windows: there is no such thing there, and the profile's ACL is what
    // keeps the key file to its owner.
    const missingOnWindows = readTavilyKey(paths_, {}, "win32");
    expect(missingOnWindows.source === "none" ? missingOnWindows.reason : "").not.toContain(
      "chmod",
    );
    // The reason names the file only when there is one to fix: doctor names it either way.
    mkdirSync(dirname(paths_.tavilyKeyFile), { recursive: true });
    writeFileSync(paths_.tavilyKeyFile, "\n", { mode: 0o600 });
    const empty = readTavilyKey(paths_, {});
    expect(empty.source === "none" ? empty.reason : "").toContain(
      "is empty; write the key into it",
    );
  });
});

describe("Serena's context", () => {
  test("it is installed beside the plugin's data, and a restore takes it out again", () => {
    const home = tempDir("mcp-serena");
    const paths_ = paths(home);
    const source = join(import.meta.dir, "..", "..", "plugin", "serena");
    const file = serenaContextSource(source);

    const first = installSerenaContext(file, paths_.serenaContextFile, paths_.stateDir, false);
    expect(first.outcome).toBe("created");
    expect(readFileSync(paths_.serenaContextFile, "utf8")).toBe(readFileSync(file, "utf8"));
    expect(readFileSync(paths_.serenaContextFile, "utf8")).toContain("single_project: false");
    expect(serenaContextCurrent(file, paths_.serenaContextFile)).toBe(true);

    // The same content again: nothing to do.
    expect(
      installSerenaContext(file, paths_.serenaContextFile, paths_.stateDir, false).outcome,
    ).toBe("unchanged");

    // A file the person edited is theirs: restore leaves it.
    writeFileSync(paths_.serenaContextFile, "# edited\n");
    expect(removeSerenaContext(file, paths_.serenaContextFile, paths_.stateDir, false)).toEqual({
      file: paths_.serenaContextFile,
      kept: true,
    });
    expect(existsSync(paths_.serenaContextFile)).toBe(true);

    // The plugin's own copy: restore removes it.
    writeFileSync(paths_.serenaContextFile, readFileSync(file, "utf8"));
    expect(removeSerenaContext(file, paths_.serenaContextFile, paths_.stateDir, false)).toEqual({
      file: paths_.serenaContextFile,
      kept: false,
    });
    expect(existsSync(paths_.serenaContextFile)).toBe(false);
  });

  test("a plugin without the file writes nothing", () => {
    const home = tempDir("mcp-serena");
    const paths_ = paths(home);
    expect(
      installSerenaContext(
        join(home, "not-there.yml"),
        paths_.serenaContextFile,
        paths_.stateDir,
        false,
      ),
    ).toEqual({ file: paths_.serenaContextFile, outcome: "missing" });
    expect(existsSync(paths_.serenaContextFile)).toBe(false);
  });
});

describe("mcp status: what is registered by something else", () => {
  // Live, 2026-10-17: a project's own script had registered `playwright` (and the other three)
  // before cc-smart-dev-kit was installed. setup left them alone — the rule — and the person
  // never saw its `!` line, so the plugin's own browser never took over. This is the read-only
  // question the installer asks before it offers to replace one, and the line `doctor` prints.
  test("ours, foreign, missing: the record decides, never the name", () => {
    const home = tempDir("mcp-status");
    const paths_ = paths(home);
    const servers = mcpServers(context(home));
    const ours = servers[0];
    const other = servers[1];
    if (ours === undefined || other === undefined) throw new Error("the servers table moved");
    mkdirSync(paths_.stateDir, { recursive: true });
    // `playwright` is ours: the record holds exactly the JSON Claude Code has for it.
    recordMcpServer(paths_.stateDir, ours.name, ours.json, "2026-10-17T00:00:00Z");
    // `serena` was registered by something else: no record of ours at all.
    writeFileSync(
      paths_.userConfigFile,
      JSON.stringify({
        mcpServers: { [ours.name]: JSON.parse(ours.json), [other.name]: JSON.parse(other.json) },
      }),
    );
    const status = mcpServerStatus(paths_);
    expect(status.find((one) => one.name === ours.name)).toEqual({
      name: ours.name,
      runsWhat: null,
      state: "ours",
    });
    expect(status.find((one) => one.name === other.name)?.state).toBe("foreign");
    expect(status.find((one) => one.name === "sequential-thinking")?.state).toBe("missing");
  });

  test("a config changed since setup registered it is foreign again: it is the person's", () => {
    const home = tempDir("mcp-status-changed");
    const paths_ = paths(home);
    const servers = mcpServers(context(home));
    const ours = servers[0];
    if (ours === undefined) throw new Error("the servers table moved");
    recordMcpServer(paths_.stateDir, ours.name, ours.json, "2026-10-17T00:00:00Z");
    writeFileSync(
      paths_.userConfigFile,
      JSON.stringify({
        mcpServers: { [ours.name]: { args: ["/somewhere/else.js"], command: "node" } },
      }),
    );
    expect(mcpServerStatus(paths_).find((one) => one.name === ours.name)).toEqual({
      name: ours.name,
      runsWhat: "node /somewhere/else.js",
      state: "foreign",
    });
  });

  test("ALL FOUR are reported, Tavily included (M3: a key may not exist yet)", () => {
    const home = tempDir("mcp-status-none");
    const paths_ = paths(home);
    // Tavily with no key is still one of the plugin's names: a server registered under it by
    // something else must be offered for replacement, whatever this machine has a key for.
    expect(mcpServerStatus(paths_).map((one) => one.name)).toEqual([
      "playwright",
      "serena",
      "sequential-thinking",
      "tavily-websearch",
    ]);
    expect(mcpServerStatus(paths_).every((one) => one.state === "missing")).toBe(true);
    // A user config that cannot be read: `unreadable`, never "missing" (the installer must not
    // ask about a server it could not check).
    mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
    writeFileSync(paths_.userConfigFile, "{not json");
    expect(mcpServerStatus(paths_).every((one) => one.state === "unreadable")).toBe(true);
  });

  test("what runs instead is the command and its arguments — never an env or a header", () => {
    // A server config can hold a key (the plugin's own Tavily one carries `${TAVILY_API_KEY}`, a
    // person's may carry the key itself), and this line is PRINTED.
    const planted = "sk-planted-SECRET";
    expect(
      describeServerConfig({
        args: ["/opt/tools/server.js", "--port", "8080"],
        command: "node",
        env: { API_KEY: planted },
        headers: { authorization: `Bearer ${planted}` },
      }),
    ).toBe("node /opt/tools/server.js --port 8080");
    // A remote server: its URL, and none of its headers.
    expect(
      describeServerConfig({
        headers: { authorization: `Bearer ${planted}` },
        url: "https://example.com/mcp",
      }),
    ).toBe("https://example.com/mcp");
    expect(describeServerConfig({ env: { API_KEY: planted } })).toBe("an unknown command");
    // A command line with a control character in it is printed as one safe line.
    expect(describeServerConfig({ args: [], command: "node\u001b[31m" })).toBe("node [31m");
  });

  test("the one line names the server, what runs instead, and the command that hands it back", () => {
    expect(
      mcpServerStatusLine({
        name: "playwright",
        runsWhat: "node /opt/tools/server.js",
        state: "foreign",
      }),
    ).toBe(
      "! playwright: registered by something else (node /opt/tools/server.js). To let setup manage it: claude mcp remove playwright --scope user, then cc-smart-dev-kit setup",
    );
    expect(mcpServerStatusLine({ name: "serena", runsWhat: null, state: "ours" })).toBe(
      "✓ serena: registered by cc-smart-dev-kit",
    );
  });
});

describe("what runs instead never carries a key", () => {
  // M1 (premium review, 2026-10-17): the line, the `--json` output and `doctor` all print what
  // a foreign server runs — and a key can sit in a URL's query or in an argument, not only in
  // `env`/`headers`. The plugin redacts; the installer prints what the JSON carries, verbatim.
  const PLANTED = "sk-planted-SECRET-0123456789abcdef";

  test("a URL: no query, no fragment, no userinfo — and the rest stays", () => {
    expect(
      describeServerConfig({ url: `https://mcp.example.com/mcp?tavilyApiKey=${PLANTED}` }),
    ).toBe("https://mcp.example.com/mcp?***");
    expect(describeServerConfig({ url: `https://mcp.example.com/mcp#token=${PLANTED}` })).toBe(
      "https://mcp.example.com/mcp",
    );
    expect(describeServerConfig({ url: `https://user:${PLANTED}@mcp.example.com/mcp` })).toBe(
      "https://***@mcp.example.com/mcp",
    );
  });

  test("an argument: the value after a key-like flag, and a key=value, become •••", () => {
    expect(
      describeServerConfig({
        args: ["/usr/local/bin/mcp-remote", "--api-key", PLANTED],
        command: "node",
      }),
    ).toBe("node /usr/local/bin/mcp-remote --api-key •••");
    expect(describeServerConfig({ args: [`--token=${PLANTED}`], command: "npx" })).toBe(
      "npx --token=•••",
    );
    expect(
      describeServerConfig({
        args: ["-password", PLANTED, "--port", "8080"],
        command: "/opt/bin/server",
      }),
    ).toBe("server -password ••• --port 8080");
  });

  test("npx mcp-remote with the key in the URL: nothing of the value is left", () => {
    const shown = describeServerConfig({
      args: ["-y", "mcp-remote", `https://mcp.tavily.com/mcp/?tavilyApiKey=${PLANTED}`],
      command: "npx",
    });
    expect(shown).toBe("npx -y mcp-remote https://mcp.tavily.com/mcp/?***");
    expect(shown).not.toContain(PLANTED);
  });

  test("the status line, its --json shape and doctor's line hold no value either", () => {
    const home = tempDir("mcp-status-secret");
    const paths_ = paths(home);
    const servers = mcpServers(context(home));
    const name = servers[0]?.name ?? "playwright";
    // A server of the person's own, registered under one of our names, with the key in a URL
    // and in an argument.
    mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
    writeFileSync(
      paths_.userConfigFile,
      JSON.stringify({
        mcpServers: {
          [name]: {
            args: [
              "mcp-remote",
              `https://mcp.example.com/mcp?key=${PLANTED}`,
              "--api-key",
              PLANTED,
            ],
            command: "npx",
          },
        },
      }),
    );
    const status = mcpServerStatus(paths_);
    const foreign = status.find((one) => one.name === name);
    expect(foreign?.state).toBe("foreign");
    expect(foreign?.runsWhat).toBe("npx mcp-remote https://mcp.example.com/mcp?*** --api-key •••");
    // The JSON is what the installer reads, so the value must be gone there too.
    expect(JSON.stringify(status)).not.toContain(PLANTED);
    expect(
      mcpServerStatusLine(foreign ?? { name, runsWhat: null, state: "missing" }),
    ).not.toContain(PLANTED);
  });
});

describe("mcp status: a records file that cannot be read", () => {
  test("every server is UNKNOWN, never foreign: the installer must not offer to replace one", () => {
    // M-low (premium review): reading an unreadable record file as "nothing is ours" made every
    // server read as foreign, and the installer would have offered to REPLACE a server that may
    // well be the plugin's own. `unknown` says: I could not tell.
    const home = tempDir("mcp-status-broken");
    const paths_ = paths(home);
    const servers = mcpServers(context(home));
    const name = servers[0]?.name ?? "playwright";
    mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
    writeFileSync(
      paths_.userConfigFile,
      JSON.stringify({ mcpServers: { [name]: { args: [], command: "node" } } }),
    );
    mkdirSync(paths_.stateDir, { recursive: true });
    writeFileSync(join(paths_.stateDir, "mcp-servers.json"), "{not json");
    const status = mcpServerStatus(paths_);
    expect(status.find((one) => one.name === name)).toEqual({
      name,
      runsWhat: null,
      state: "unknown",
    });
    expect(mcpServerStatusLine({ name, runsWhat: null, state: "unknown" })).toBe(
      `! ${name} is registered, but what cc-smart-dev-kit registered cannot be read back: check it by hand (claude mcp get ${name}), then run cc-smart-dev-kit setup`,
    );
  });
});

describe("a Tavily key the settings hold, and nowhere else", () => {
  // M2 (premium review, 2026-10-17): the installer stopped asking when `env.TAVILY_API_KEY` was
  // in the settings, but `readTavilyKey` did not read settings — so setup registered NO Tavily
  // server on such a machine, while setup's own design writes the key there BECAUSE Claude Code
  // expands `${TAVILY_API_KEY}` from the settings' `env` as well as the process environment
  // (`userSettings`/`flagSettings`/`policySettings` `.env`, read in the installed 2.1.302).
  test("readTavilyKey: environment first, then the settings, then the key file", () => {
    const home = tempDir("mcp-tavily-settings");
    const paths_ = paths(home);
    mkdirSync(dirname(paths_.settingsFile), { recursive: true });
    writeFileSync(
      paths_.settingsFile,
      JSON.stringify({ env: { TAVILY_API_KEY: "tvly-in-settings" } }),
    );
    expect(readTavilyKey(paths_, {})).toEqual({ source: "settings" });
    // The environment wins (the person's own, live value).
    expect(readTavilyKey(paths_, { TAVILY_API_KEY: "tvly-in-env" })).toEqual({
      source: "environment",
    });
    // An empty value in the settings is not a key: the key file is read next.
    writeFileSync(paths_.settingsFile, JSON.stringify({ env: { TAVILY_API_KEY: "  " } }));
    mkdirSync(dirname(paths_.tavilyKeyFile), { recursive: true });
    writeFileSync(paths_.tavilyKeyFile, "tvly-in-file\n", { mode: 0o600 });
    expect(readTavilyKey(paths_, {})).toEqual({ source: "file", value: "tvly-in-file" });
    // A settings file that cannot be read is not a key either, and never an error.
    writeFileSync(paths_.settingsFile, "{not json");
    expect(readTavilyKey(paths_, {}).source).toBe("file");
  });

  test("setup registers the server, and leaves the key where it is", () => {
    const home = tempDir("mcp-tavily-setup");
    const paths_ = paths(home);
    mkdirSync(dirname(paths_.settingsFile), { recursive: true });
    writeFileSync(
      paths_.settingsFile,
      `${JSON.stringify({ env: { TAVILY_API_KEY: "tvly-in-settings" } }, null, 2)}\n`,
    );
    const context_ = {
      ...context(home),
      tavily: { key: true } as const,
    };
    const plan = planMcpServers(mcpServers(context_), {}, {});
    expect(plan.find((one) => one.name === "tavily-websearch")?.action).toBe("add");
    expect(
      mcpServers(context_).find((one) => one.name === "tavily-websearch")?.skipped,
    ).toBeUndefined();
  });
});

describe("M3: the live scenario — all four registered by a project's script", () => {
  // Live, 2026-10-17: a project's own script had registered all four names at user scope, and
  // the Tavily one carried the key in ITS OWN `env` — the machine had no `TAVILY_API_KEY`
  // anywhere the plugin looked. `mcpServerStatus` used to leave Tavily out then, so the
  // installer never offered to replace it, and that server went on shadowing the plugin's own.
  test("Tavily is foreign on such a machine, with what runs instead", () => {
    const home = tempDir("mcp-status-project-script");
    const paths_ = paths(home);
    const servers = mcpServers(context(home));
    // Every one of the four, as a project's script would leave them, the Tavily one with a key
    // in its own env.
    const registered: Record<string, unknown> = {};
    for (const server of servers) {
      registered[server.name] = {
        args: ["/opt/tools/server.js", "--port", "8080"],
        command: "node",
        ...(server.name === "tavily-websearch"
          ? { env: { TAVILY_API_KEY: "tvly-project-copy" } }
          : {}),
      };
    }
    mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
    writeFileSync(paths_.userConfigFile, JSON.stringify({ mcpServers: registered }));
    const status = mcpServerStatus(paths_);
    expect(status.map((one) => `${one.name}:${one.state}`)).toEqual([
      "playwright:foreign",
      "serena:foreign",
      "sequential-thinking:foreign",
      "tavily-websearch:foreign",
    ]);
    // What runs instead: the command and its arguments, and never that server's key.
    const tavily = status.find((one) => one.name === "tavily-websearch");
    expect(tavily?.runsWhat).toBe("node /opt/tools/server.js --port 8080");
    expect(JSON.stringify(status)).not.toContain("tvly-project-copy");
  });
});

describe("a same-name server one scope down wins over the user scope", () => {
  // Low, premium review 2026-10-17: doctor reported the user-scope server as fine while a copy
  // at LOCAL scope or in a project's `.mcp.json` was the one Claude Code really starts.
  test("the local scope wins: `projects[<cwd>].mcpServers` in Claude Code's own file", () => {
    const home = tempDir("mcp-override-local");
    const paths_ = paths(home);
    const cwd = join(home, "project");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
    writeFileSync(
      paths_.userConfigFile,
      JSON.stringify({
        mcpServers: {},
        projects: { [cwd]: { mcpServers: { playwright: { args: [], command: "node" } } } },
      }),
    );
    expect(overridingServer(paths_.userConfigFile, cwd, "playwright")).toEqual({
      config: { args: [], command: "node" },
      file: paths_.userConfigFile,
    });
    // Another folder's local entry is not this folder's.
    expect(
      overridingServer(paths_.userConfigFile, join(home, "elsewhere"), "playwright"),
    ).toBeNull();
  });

  test("a project `.mcp.json` wins, nearest file first, and never a key in the line", () => {
    const home = tempDir("mcp-override-project");
    const paths_ = paths(home);
    const project = join(home, "repo");
    const sub = join(project, "app");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(project, ".git"), { recursive: true });
    const planted = "sk-planted-SECRET";
    writeFileSync(
      join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: { playwright: { args: ["--api-key", planted], command: "/opt/bin/other" } },
      }),
    );
    const found = overridingServer(paths_.userConfigFile, sub, "playwright");
    expect(found?.file).toBe(join(project, ".mcp.json"));
    expect(describeServerConfig(found?.config)).toBe("other --api-key •••");
    expect(describeServerConfig(found?.config)).not.toContain(planted);
    // Nothing of the plugin's: null, so doctor says nothing.
    expect(overridingServer(paths_.userConfigFile, sub, "serena")).toBeNull();
  });

  test("doctor's line names the file and what runs instead", () => {
    const home = tempDir("mcp-doctor-override");
    const paths_ = paths(home);
    const project = join(home, "repo");
    mkdirSync(join(project, ".git"), { recursive: true });
    writeFileSync(
      join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { playwright: { args: [], command: "/opt/bin/other" } } }),
    );
    // A user-scope server that IS ours: the record holds exactly the JSON Claude Code has.
    const servers = mcpServers(context(home));
    const ours = servers.find((one) => one.name === "playwright");
    if (ours === undefined) throw new Error("the servers table moved");
    mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
    writeFileSync(
      paths_.userConfigFile,
      JSON.stringify({ mcpServers: { playwright: JSON.parse(ours.json) } }),
    );
    recordMcpServer(paths_.stateDir, ours.name, ours.json, "2026-10-17T00:00:00Z");
    const checks = mcpChecks(
      paths_,
      {
        run: () => ({ ok: true, output: "Scope: User config\nStatus: ✓ Connected" }),
        which: () => "/usr/bin/claude",
      },
      {},
      project,
    );
    const line = checks.find((one) => one.text.includes("wins over yours"));
    expect(line?.warn).toBe(true);
    expect(line?.ok).toBe(true);
    // The command's own name, and the file tildified: what a person reads.
    expect(line?.text).toBe(
      'the "playwright" MCP server has a copy that wins over yours (other in ~/repo/.mcp.json): ' +
        "a project's .mcp.json, or the local scope, takes precedence over the user-scope server, so " +
        "cc-smart-dev-kit's is not the one starting. Remove it from that file (or merge the base " +
        "branch when it came from one), then run: cc-smart-dev-kit doctor",
    );
  });
});
