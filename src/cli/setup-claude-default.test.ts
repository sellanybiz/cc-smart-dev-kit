/**
 * D66, the owner (2026-10-25): "by default everything will be set to Claude … the gateway will be
 * off". A machine set up before it moves there once, in `cc-smart-dev-kit setup`: every slot's chain
 * removed (the machine's and each profile's), every fallback switch off, the gateway turned off
 * through the code `gateway off` runs, claude-mem back on Claude Haiku (it follows the scout) —
 * with a backup first, one line per change, and a marker so a chain or a switch set afterwards is
 * never touched again. The pure plan is tested in `src/gateway/claude-defaults.test.ts`.
 *
 * Run in this process with a fake machine (`src/testing/fake-machine.ts`); expected values are
 * written by hand.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { claudeDefaultsMarkerFile } from "../gateway/claude-defaults";
import { turnOn } from "../gateway/settings";
import { applyClaudeMem, claudeMemPlan } from "../machine/claude-mem";
import { chooseRoute, readClaudeMemFacts } from "../machine/claude-mem-choices";
import { BACKUPS_DIR, listBackups } from "../setup/write";
import { capturePrinted, printed, world } from "../testing/fake-machine";

capturePrinted();

const SCOUT = "cc-smart-dev-kit-scout";
const WORKER = "cc-smart-dev-kit-worker";
const OPUS = "cc-smart-dev-kit-opus";
const JUDGE = "cc-smart-dev-kit-judge";
const FABLE = "cc-smart-dev-kit-fable";
/** The router's port in these tests: one of the test's own, never the live router's. */
const PORT = 47123;
const ROUTER = `http://127.0.0.1:${PORT}`;
const ANTHROPIC = "https://api.anthropic.com";

/** A machine set up before 1.2.0: chains in four slots, switches on, a profile, a saved chain. */
function oldConfig(): Record<string, unknown> {
  return {
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
    fallback: { [JUDGE]: true, [SCOUT]: false, [WORKER]: true },
    judgeTested: { "omniroute:j1": "0".repeat(32) },
    kept: { [FABLE]: { fallback: true, targets: ["omniroute:f1"] } },
    port: PORT,
    profiles: {
      team: {
        fallback: { [WORKER]: true },
        slots: { [SCOUT]: "claude", [WORKER]: ["omniroute:p1", "omniroute:p2"] },
      },
    },
    slots: {
      [JUDGE]: ["omniroute:j1"],
      [OPUS]: ["omniroute:o1"],
      [SCOUT]: ["omniroute:a1", "omniroute:a2"],
      [WORKER]: ["omniroute:w1", "omniroute:w2"],
    },
    version: 1,
  };
}

type World = ReturnType<typeof world>;

function writeGateway(w: World, config: unknown): string {
  mkdirSync(dirname(w.paths.gatewayConfigFile), { recursive: true });
  const text = typeof config === "string" ? config : `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(w.paths.gatewayConfigFile, text, { mode: 0o600 });
  return text;
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const gatewayJson = (w: World) => readJson(w.paths.gatewayConfigFile);
const baseUrl = (w: World): unknown => readJson(w.paths.settingsFile).env?.ANTHROPIC_BASE_URL;
const markerExists = (w: World) => existsSync(claudeDefaultsMarkerFile(w.paths.stateDir));

/** A machine with an old gateway set up and on. */
function oldMachine() {
  const w = world();
  const text = writeGateway(w, oldConfig());
  turnOn({ settingsFile: w.paths.settingsFile, stateDir: w.paths.stateDir, port: PORT });
  return { w, text };
}

/** The lines of the report that start with `  <mark> ` — the section's own lines. */
const sectionLines = () => printed.filter((line) => /^ {2}[~+\-!·$✗] /.test(line));

describe("D66: setup moves a machine set up before it to Claude defaults, once", () => {
  test("chains, fallbacks on and the gateway on: every slot Claude, every fallback off, the gateway off", async () => {
    const { w } = oldMachine();
    expect(baseUrl(w)).toBe(ROUTER);
    expect(await w.setup()).toBe(0);

    const moved = gatewayJson(w);
    expect(moved.slots).toEqual({});
    expect(moved.fallback).toBeUndefined();
    expect(moved.kept[FABLE]).toEqual({ targets: ["omniroute:f1"] });
    // The chains wait in `kept`: `gateway slot <slot> custom` brings one back.
    expect(moved.kept[SCOUT].targets).toEqual(["omniroute:a1", "omniroute:a2"]);
    expect(moved.kept[WORKER].targets).toEqual(["omniroute:w1", "omniroute:w2"]);
    expect(moved.kept[OPUS].targets).toEqual(["omniroute:o1"]);
    expect(moved.kept[JUDGE].targets).toEqual(["omniroute:j1"]);
    expect(moved.backends.omniroute.apiKey).toBe("omni-key-123456");
    // The gateway is off through the code `gateway off` runs: Anthropic's own address.
    expect(baseUrl(w)).toBe(ANTHROPIC);
    expect(markerExists(w)).toBe(true);
  });

  test("a profile's slots move too: its chain goes, its explicit Claude and its project's URL stay", async () => {
    const { w } = oldMachine();
    await w.setup();
    expect(gatewayJson(w).profiles).toEqual({ team: { slots: { [SCOUT]: "claude" } } });
  });

  test("a backup of gateway.json comes first and holds the old file; its folder is named", async () => {
    const { w, text } = oldMachine();
    await w.setup();
    const backups = listBackups(w.paths.stateDir, w.paths.gatewayConfigFile);
    expect(backups).toHaveLength(1);
    expect(readFileSync(backups[0]?.path ?? "", "utf8")).toBe(text);
    expect(printed).toContain(
      `  · the config as it was before is in ~/.claude/cc-smart-dev-kit/${BACKUPS_DIR}/${encodeURIComponent(w.paths.gatewayConfigFile)}/`,
    );
  });

  test("one line per change, old → new, under a Gateway section, and the restart step", async () => {
    const { w } = oldMachine();
    await w.setup();
    const said = (line: string) => line.includes("→") || line.startsWith("  ~ the gateway");
    expect(sectionLines().filter(said)).toEqual([
      "  ~ the gateway: on → off",
      "  ~ scout: omniroute:a1,omniroute:a2 → Claude",
      "  ~ worker: omniroute:w1,omniroute:w2 → Claude",
      "  ~ opus: omniroute:o1 → Claude",
      "  ~ judge: omniroute:j1 → Claude",
      "  ~ profile team worker: omniroute:p1,omniroute:p2 → Claude",
      "  ~ fallback worker: on → off",
      "  ~ fallback fable (saved chain): on → off",
      "  ~ profile team fallback worker: on → off",
    ]);
    expect(printed).toContain(
      `  ~ ~/.claude/settings.json: env.ANTHROPIC_BASE_URL: "${ROUTER}" -> "${ANTHROPIC}"`,
    );
    expect(printed.some((line) => line.startsWith("Gateway "))).toBe(false);
    expect(printed.some((line) => /^[~✓+] Gateway {5,}\d+ changes?/.test(line))).toBe(true);
    expect(printed.some((line) => line.includes("Start a new Claude Code session"))).toBe(true);
  });

  test("once only: a chain set after it survives the next setup, and a gateway turned on stays on", async () => {
    const { w } = oldMachine();
    await w.setup();
    const config = gatewayJson(w);
    config.slots = { [WORKER]: ["omniroute:later"] };
    config.fallback = { [WORKER]: true };
    writeGateway(w, config);
    turnOn({ settingsFile: w.paths.settingsFile, stateDir: w.paths.stateDir, port: PORT });
    const before = readFileSync(w.paths.gatewayConfigFile, "utf8");

    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(readFileSync(w.paths.gatewayConfigFile, "utf8")).toBe(before);
    expect(baseUrl(w)).toBe(ROUTER);
    expect(printed.some((line) => line.includes("Gateway"))).toBe(false);
    expect(listBackups(w.paths.stateDir, w.paths.gatewayConfigFile)).toHaveLength(1);
  });

  test("--dry-run shows the lines and changes nothing: no file, no backup, no marker", async () => {
    const { w, text } = oldMachine();
    const settings = readFileSync(w.paths.settingsFile, "utf8");
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(readFileSync(w.paths.gatewayConfigFile, "utf8")).toBe(text);
    expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(settings);
    expect(markerExists(w)).toBe(false);
    expect(listBackups(w.paths.stateDir, w.paths.gatewayConfigFile)).toEqual([]);
    expect(printed).toContain("  ~ scout: omniroute:a1,omniroute:a2 → Claude");
    expect(printed).toContain("  ~ the gateway: on → off");
    // …and a real run afterwards still moves.
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(gatewayJson(w).slots).toEqual({});
    expect(baseUrl(w)).toBe(ANTHROPIC);
  });

  test("no gateway.json: nothing to move and nothing said; the marker is written, so a later chain stays", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    expect(printed.some((line) => line.includes("Gateway"))).toBe(false);
    expect(markerExists(w)).toBe(true);

    writeGateway(w, { ...oldConfig(), fallback: undefined, kept: undefined, profiles: undefined });
    const before = readFileSync(w.paths.gatewayConfigFile, "utf8");
    expect(await w.setup()).toBe(0);
    expect(readFileSync(w.paths.gatewayConfigFile, "utf8")).toBe(before);
  });

  test("--dry-run with no gateway.json writes no marker", async () => {
    const w = world();
    await w.setup({ dryRun: true });
    expect(markerExists(w)).toBe(false);
  });

  test("a gateway.json that cannot be read: one ! line, no marker, setup goes on and exits 0", async () => {
    const w = world();
    const text = writeGateway(w, "{ not json");
    expect(await w.setup()).toBe(0);
    const warning = printed.filter(
      (line) => line.startsWith("  ! ") && line.includes("gateway.json"),
    );
    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain("Claude");
    expect(markerExists(w)).toBe(false);
    expect(readFileSync(w.paths.gatewayConfigFile, "utf8")).toBe(text);
    // Fixed by hand, the next setup moves it.
    writeGateway(w, oldConfig());
    expect(await w.setup()).toBe(0);
    expect(gatewayJson(w).slots).toEqual({});
  });

  test("a gateway already all Claude and off: nothing to say, the marker is written", async () => {
    const w = world();
    writeGateway(w, {
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
      slots: {},
      version: 1,
    });
    expect(await w.setup()).toBe(0);
    expect(printed.some((line) => line.includes("Gateway"))).toBe(false);
    expect(markerExists(w)).toBe(true);
    expect(listBackups(w.paths.stateDir, w.paths.gatewayConfigFile)).toEqual([]);
  });

  test("the gateway on with no chain at all is turned off too", async () => {
    const w = world();
    writeGateway(w, { backends: {}, port: PORT, slots: {}, version: 1 });
    turnOn({ settingsFile: w.paths.settingsFile, stateDir: w.paths.stateDir, port: PORT });
    await w.setup();
    expect(baseUrl(w)).toBe(ANTHROPIC);
    expect(printed).toContain("  ~ the gateway: on → off");
  });

  test("an address of the person's own that is not the router's: left alone, and not named", async () => {
    // A company proxy, say. The gateway was never on from the kit's side, and the person did
    // not ask to turn anything off: no "remove it by hand" for a value that is theirs.
    const { w } = oldMachine();
    const settings = readJson(w.paths.settingsFile);
    settings.env.ANTHROPIC_BASE_URL = "http://10.0.0.5:9000";
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(baseUrl(w)).toBe("http://10.0.0.5:9000");
    expect(printed.filter((line) => line.includes("env.ANTHROPIC_BASE_URL stays"))).toEqual([]);
  });

  test("the router's own address, written by hand, still routes: named with !, never overwritten", async () => {
    const w = world();
    writeGateway(w, oldConfig());
    const settings = readJson(w.paths.settingsFile);
    settings.env = { ...settings.env, ANTHROPIC_BASE_URL: ROUTER };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(baseUrl(w)).toBe(ROUTER);
    expect(
      printed.filter((line) => line.startsWith("  ! env.ANTHROPIC_BASE_URL stays")),
    ).toHaveLength(1);
  });

  test("a project's own switch is left as it is, and the line says so", async () => {
    const { w } = oldMachine();
    await w.setup();
    expect(printed).toContain(
      "  · a project's own switch (gateway project on) is left as it is: cc-smart-dev-kit gateway projects lists them",
    );
  });

  test("nothing moved, nothing said about projects", async () => {
    const w = world();
    writeGateway(w, { backends: {}, port: PORT, slots: {}, version: 1 });
    await w.setup();
    expect(printed.filter((line) => line.includes("a project's own switch"))).toEqual([]);
  });

  test("a moved slot loses its fallback record in the router's state file, as `gateway slot <slot> claude` does", async () => {
    const { w } = oldMachine();
    const record = {
      lastAt: 2,
      model: "claude-sonnet-5-5",
      resetsAt: null,
      since: 1,
      target: "omniroute:w2",
    };
    mkdirSync(dirname(w.paths.gatewayStateFile), { recursive: true });
    writeFileSync(
      w.paths.gatewayStateFile,
      JSON.stringify({ fallbacks: { [WORKER]: record, [FABLE]: record }, limits: {}, version: 1 }),
    );
    await w.setup();
    // The worker moved (it had a chain); the fable slot had only a saved chain, so it did not.
    expect(Object.keys(readJson(w.paths.gatewayStateFile).fallbacks)).toEqual([FABLE]);
  });
});

const SEEDED = {
  CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_MEM_PROVIDER: "claude",
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
  CLAUDE_MEM_WORK_STATE_ENABLED: "true",
  CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "true",
};

const PROVIDER_KEYS = [
  "CLAUDE_MEM_PROVIDER",
  "CLAUDE_MEM_OPENAI_COMPAT_PRESET",
  "CLAUDE_MEM_OPENAI_COMPAT_BASE_URL",
  "CLAUDE_MEM_OPENAI_COMPAT_MODEL",
  "CLAUDE_MEM_OPENAI_COMPAT_API_KEY",
];

/** What an older setup did: claude-mem pointed at the scout's first target. */
function pointedAtTheScout(w: World): void {
  mkdirSync(dirname(w.paths.claudeMemSettingsFile), { recursive: true });
  writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(SEEDED, null, 2), { mode: 0o600 });
  const planned = claudeMemPlan(w.paths);
  if (!("plan" in planned)) throw new Error("expected a plan");
  expect(planned.plan.provider?.target.model).toBe("a1");
  applyClaudeMem(w.paths, planned.plan, false);
  expect(readJson(w.paths.claudeMemSettingsFile).CLAUDE_MEM_PROVIDER).toBe("openai-compatible");
}

describe("D66: claude-mem follows the scout back to Claude Haiku", () => {
  test("the five provider keys go; claude-mem's provider is claude and its model stays Haiku", async () => {
    const { w } = oldMachine();
    pointedAtTheScout(w);
    expect(await w.setup()).toBe(0);
    const written = readJson(w.paths.claudeMemSettingsFile);
    for (const key of PROVIDER_KEYS) expect(written[key]).toBeUndefined();
    // claude-mem's own default is Claude on Haiku: no model id is typed anywhere in the kit.
    expect(written.CLAUDE_MEM_MODEL).toBe("claude-haiku-4-5-20251001");
    const route = readClaudeMemFacts(w.paths).current?.route;
    expect(route?.kind).toBe("claude");
    expect(route?.provider).toBe("claude");
    expect(
      printed.some((line) => line.includes("CLAUDE_MEM_PROVIDER") && line.includes("claude")),
    ).toBe(true);
    expect(JSON.stringify(printed)).not.toContain("omni-key-123456");
  });

  test("the dry run says the same and writes nothing", async () => {
    const { w } = oldMachine();
    pointedAtTheScout(w);
    const before = readFileSync(w.paths.claudeMemSettingsFile, "utf8");
    await w.setup({ dryRun: true });
    expect(readFileSync(w.paths.claudeMemSettingsFile, "utf8")).toBe(before);
    expect(printed.some((line) => line.includes("CLAUDE_MEM_PROVIDER"))).toBe(true);
  });

  test("a route the person chose in the portal is theirs: the move leaves it", async () => {
    const { w } = oldMachine();
    mkdirSync(dirname(w.paths.claudeMemSettingsFile), { recursive: true });
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(SEEDED, null, 2), { mode: 0o600 });
    const chosen = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "mine" },
      async () => null,
    );
    expect(chosen.ok).toBe(true);
    const before = readJson(w.paths.claudeMemSettingsFile);
    expect(before.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("mine");
    await w.setup();
    const after = readJson(w.paths.claudeMemSettingsFile);
    for (const key of PROVIDER_KEYS) expect(after[key]).toEqual(before[key]);
    // …while the slots still moved.
    expect(gatewayJson(w).slots).toEqual({});
  });

  test("a provider key the person edited by hand stays, all five of them, and setup says so", async () => {
    const { w } = oldMachine();
    pointedAtTheScout(w);
    const edited = readJson(w.paths.claudeMemSettingsFile);
    edited.CLAUDE_MEM_OPENAI_COMPAT_MODEL = "by-hand";
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(edited, null, 2));
    await w.setup();
    const after = readJson(w.paths.claudeMemSettingsFile);
    for (const key of PROVIDER_KEYS) expect(after[key]).toEqual(edited[key]);
    expect(
      printed.filter(
        (line) => line.includes("CLAUDE_MEM_OPENAI_COMPAT_MODEL") && line.includes("your choice"),
      ),
    ).toHaveLength(1);
  });
});

describe("D66: setup is the only caller", () => {
  const src = join(import.meta.dir, "..");
  const target = join(src, "gateway", "claude-defaults.ts");

  /** The relative imports a file makes, resolved to files (the walk `out.test.ts` makes). */
  function reach(entry: string): Set<string> {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8").replace(/\bwith\s*\{\s*type:\s*"macro"\s*\}/g, "");
      for (const { path } of transpiler.scanImports(source)) {
        if (!path.startsWith(".")) continue;
        const base = join(dirname(file), path);
        const found = [base, `${base}.ts`, join(base, "index.ts")].find((one) => existsSync(one));
        if (found?.endsWith(".ts")) queue.push(found);
      }
    }
    return seen;
  }

  const hookEntries = readdirSync(join(src, "entries"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .filter((name) => name !== "cli.ts" && name !== "portal.ts")
    .map((name) => join(src, "entries", name));
  const updateFiles = readdirSync(join(src, "update"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(src, "update", name));

  test("the walk finds the module where it is used: the setup command", () => {
    expect(reach(join(src, "cli", "setup.ts")).has(target)).toBe(true);
  });

  test("no hook bundle (SessionStart's included) and no file of the background update reaches it", () => {
    expect(hookEntries.length).toBeGreaterThan(5);
    expect(updateFiles.length).toBeGreaterThan(3);
    for (const entry of [...hookEntries, ...updateFiles]) {
      expect({ entry, reaches: reach(entry).has(target) }).toEqual({ entry, reaches: false });
    }
  });
});

test("D66 keeps a personal Fable pin without a routing warning", async () => {
  const { w } = oldMachine();
  const value = readJson(w.paths.settingsFile);
  value.env.ANTHROPIC_DEFAULT_FABLE_MODEL = "claude-fable-5-1";
  writeFileSync(w.paths.settingsFile, JSON.stringify(value));
  expect(await w.setup()).toBe(0);
  expect(baseUrl(w)).toBe(ANTHROPIC);
  expect(readJson(w.paths.settingsFile).env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-1");
  expect(printed.join("\n")).not.toContain(
    "env.ANTHROPIC_DEFAULT_FABLE_MODEL stays: cc-smart-dev-kit did not set it. Remove it by hand to turn the gateway off",
  );
});
