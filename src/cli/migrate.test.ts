/**
 * `cc-smart-dev-kit migrate`: a temp HOME holding a machine that ran the old `anymodel`
 * names — its folders, its state folder's records and backups, its settings keys, its
 * instructions block, its gateway config and its router units — with a fake `systemctl`
 * and a fake `claude` on PATH, and a fake health probe. No real port, no real plugin, no
 * real machine.
 *
 * The fixture is built with the OLD paths and names on purpose: it is what the old version
 * left behind. This file and `migrate.ts` are the only code that may name them.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import type { HealthProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { gatewayEnv } from "../gateway/settings";
import { backupDir, listBackups, realTarget } from "../setup/write";
import { capturePrinted, printed } from "../testing/fake-machine";
import { tempDir } from "../testing/temp";
import { type MigrateOptions, OLD, oldGatewayEnv, runMigrate } from "./migrate";
import { cliPaths } from "./paths";
import { runRestore } from "./restore";

capturePrinted();

const PORT = 20151;
const STAMP = "20261015T101010101Z";
const RULE = "In my-app: never touch the production database.";
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/**
 * A temp HOME as the old version left it. `run` runs migrate in this process, with the
 * fakes; `runRestore` runs restore the same way.
 */
function machine() {
  const home = tempDir("migrate");
  const configDir = join(home, ".claude");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  const systemd = join(home, ".config", "systemd", "user");
  const oldStateDir = join(configDir, OLD.name);
  const oldConfigDir = join(home, ".config", OLD.name);
  const oldShareDir = join(home, ".local", "share", OLD.name);
  const oldStateHomeDir = join(home, ".local", "state", OLD.name);
  const oldLauncher = join(home, ".local", "bin", OLD.name);
  const oldUnitFile = join(systemd, OLD.unit);
  const oldSocketFile = join(systemd, OLD.socket);
  const oldRouterCopy = join(oldShareDir, "router.js");
  const settingsFile = paths.settingsFile;
  const claudeMd = join(configDir, "CLAUDE.md");

  // ─── The settings the old setup wrote ───
  const settings = {
    model: "opus",
    env: oldGatewayEnv(PORT),
    enabledPlugins: { [OLD.pluginId]: true, "cc-smart-dev-kit@cc-smart-dev-kit": true },
    extraKnownMarketplaces: {
      [OLD.marketplace]: { source: { source: "github", repo: "example-org/anymodel" } },
      "cc-smart-dev-kit": { source: { source: "github", repo: "example-org/cc-smart-dev-kit" } },
    },
    autoMode: { environment: ["$defaults", RULE] },
  };
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  writeFileSync(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        [OLD.pluginId]: [
          { scope: "user", installPath: join(home, "old-plugin"), version: "0.2.1" },
        ],
        "cc-smart-dev-kit@cc-smart-dev-kit": [
          { scope: "user", installPath: join(home, "new-plugin"), version: VERSION },
        ],
      },
    }),
  );

  // ─── The instructions block and its managed copy ───
  writeFileSync(
    claudeMd,
    [
      "# My notes",
      "",
      `${OLD.blockBegin}`,
      `<!-- Written by ${OLD.name} setup. \`${OLD.name} setup --no-instructions\` takes it out. -->`,
      `@~/.claude/${OLD.name}/instructions/core.md`,
      `${OLD.blockEnd}`,
      "",
      "Text of my own, after the block.",
      "",
    ].join("\n"),
  );
  mkdirSync(join(oldStateDir, "instructions"), { recursive: true });
  writeFileSync(join(oldStateDir, "instructions", "core.md"), "The old instructions.\n");
  writeFileSync(join(oldStateDir, "instructions-version"), "0.2.1\n");

  // ─── The state folder's records and backups ───
  const launcherReal = realTarget(oldLauncher);
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(oldLauncher, `#!/bin/sh\n# the old launcher\necho "${OLD.name} 0.2.1"\n`);
  chmodSync(oldLauncher, 0o755);
  mkdirSync(oldShareDir, { recursive: true });
  writeFileSync(oldRouterCopy, "// the old router copy\n");
  mkdirSync(oldStateHomeDir, { recursive: true });
  writeFileSync(
    join(oldStateHomeDir, "gateway-state.json"),
    `${JSON.stringify(
      {
        fallbacks: {
          [`${OLD.name}-opus`]: {
            lastAt: 1,
            model: "claude-opus-5-5",
            resetsAt: null,
            since: 1,
            target: "omniroute:glm-5.3-flash",
          },
        },
        limits: {},
        version: 1,
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(systemd, { recursive: true });
  writeFileSync(oldUnitFile, "# the old unit\n");
  writeFileSync(oldSocketFile, "# the old socket\n");

  const settingsReal = realTarget(settingsFile);
  const claudeMdReal = realTarget(claudeMd);
  const coreReal = realTarget(join(oldStateDir, "instructions", "core.md"));
  const unitReal = realTarget(oldUnitFile);
  const socketReal = realTarget(oldSocketFile);
  const copyReal = realTarget(oldRouterCopy);
  const backup = (file: string, name: string) => join(backupDir(oldStateDir, file), name);
  mkdirSync(backupDir(oldStateDir, settingsFile), { recursive: true });
  writeFileSync(backup(settingsFile, `settings.json${OLD.backupInfix}${STAMP}`), "{}\n");
  mkdirSync(backupDir(oldStateDir, claudeMd), { recursive: true });
  writeFileSync(backup(claudeMd, `CLAUDE.md${OLD.backupInfix}${STAMP}`), "# My notes\n");
  // The launcher did not exist before the old setup: its baseline is an `.absent` marker.
  mkdirSync(backupDir(oldStateDir, oldLauncher), { recursive: true });
  writeFileSync(backup(oldLauncher, `${OLD.name}${OLD.backupInfix}${STAMP}.absent`), "");
  mkdirSync(backupDir(oldStateDir, oldUnitFile), { recursive: true });
  writeFileSync(backup(oldUnitFile, `${OLD.unit}${OLD.backupInfix}${STAMP}.absent`), "");
  mkdirSync(backupDir(oldStateDir, oldSocketFile), { recursive: true });
  writeFileSync(backup(oldSocketFile, `${OLD.socket}${OLD.backupInfix}${STAMP}.absent`), "");
  mkdirSync(backupDir(oldStateDir, oldRouterCopy), { recursive: true });
  writeFileSync(backup(oldRouterCopy, `router.js${OLD.backupInfix}${STAMP}.absent`), "");
  mkdirSync(backupDir(oldStateDir, join(oldStateDir, "instructions", "core.md")), {
    recursive: true,
  });
  writeFileSync(backup(coreReal, `core.md${OLD.backupInfix}${STAMP}.absent`), "");

  const ownedKeys = Object.keys(oldGatewayEnv(PORT));
  writeFileSync(
    join(oldStateDir, "owned.json"),
    `${JSON.stringify(
      {
        [settingsReal]: ownedKeys.map((key) => ({
          path: ["env", key],
          value: oldGatewayEnv(PORT)[key],
        })),
        [claudeMdReal]: [{ path: ["x"], value: 1 }],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(oldStateDir, "owned-entries.json"),
    `${JSON.stringify(
      {
        [settingsReal]: {
          [JSON.stringify(["autoMode", "environment"])]: [
            { entry: RULE, source: "/home/user/my-app" },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(oldStateDir, "changed.json"),
    `${JSON.stringify(
      {
        files: {
          [launcherReal]: {
            kinds: ["whole-file"],
            baseline: backup(oldLauncher, `${OLD.name}${OLD.backupInfix}${STAMP}.absent`),
          },
          [settingsReal]: {
            kinds: ["json-keys", "json-entries"],
            baseline: backup(settingsFile, `settings.json${OLD.backupInfix}${STAMP}`),
          },
          [claudeMdReal]: {
            kinds: ["markdown-block"],
            baseline: backup(claudeMd, `CLAUDE.md${OLD.backupInfix}${STAMP}`),
          },
          [unitReal]: {
            kinds: ["whole-file"],
            baseline: backup(oldUnitFile, `${OLD.unit}${OLD.backupInfix}${STAMP}.absent`),
          },
          [socketReal]: {
            kinds: ["whole-file"],
            baseline: backup(oldSocketFile, `${OLD.socket}${OLD.backupInfix}${STAMP}.absent`),
          },
          [copyReal]: {
            kinds: ["whole-file"],
            baseline: backup(oldRouterCopy, `router.js${OLD.backupInfix}${STAMP}.absent`),
          },
          [coreReal]: {
            kinds: ["whole-file"],
            baseline: backup(coreReal, `core.md${OLD.backupInfix}${STAMP}.absent`),
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  // ─── The gateway config (mode 600) and the machine's job settings ───
  mkdirSync(oldConfigDir, { recursive: true });
  writeFileSync(
    join(oldConfigDir, "gateway.json"),
    `${JSON.stringify(
      {
        aliases: {},
        anthropicBaseUrl: "https://api.anthropic.com",
        backends: {
          omniroute: { apiKey: "sk-test-key-0123456789abcdef", baseUrl: "http://127.0.0.1:20128" },
        },
        judgeTested: { "omniroute:glm-5.3-flash": "a-proof" },
        modelSlots: { "claude-opus-5-5": `${OLD.name}-opus` },
        port: PORT,
        slots: {
          [`${OLD.name}-judge`]: ["omniroute:glm-5.3-flash"],
          [`${OLD.name}-opus`]: ["claude-opus-5-5", "omniroute:glm-5.3-flash"],
          [`${OLD.name}-scout`]: ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"],
          [`${OLD.name}-worker`]: ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"],
        },
        version: 1,
      },
      null,
      2,
    )}\n`,
  );
  chmodSync(join(oldConfigDir, "gateway.json"), 0o600);
  writeFileSync(join(oldConfigDir, "jobs.json"), `${JSON.stringify({ reserveGb: 20 }, null, 2)}\n`);
  writeFileSync(join(home, ".tmux.conf"), `set -g allow-passthrough all\n`);

  // ─── A fake systemctl, and a fake claude, alone on the runner's PATH ───
  const fakeBin = join(home, "fake-bin");
  mkdirSync(fakeBin);
  const unitState = join(home, "unit-state");
  const socketState = join(home, "socket-state");
  const systemctlLog = join(home, "systemctl.log");
  const claudeLog = join(home, "claude.log");
  writeFileSync(
    join(fakeBin, "systemctl"),
    [
      "#!/bin/sh",
      `echo "$*" >> '${systemctlLog}'`,
      "s=inactive",
      `[ -e '${unitState}' ] && read s < '${unitState}'`,
      "k=inactive",
      `[ -e '${socketState}' ] && read k < '${socketState}'`,
      "set_to() {",
      `  case "$2" in *.service*) echo "$1" > '${unitState}' ;; esac`,
      `  case "$2" in *.socket*) echo "$1" > '${socketState}' ;; esac`,
      "}",
      'case "$*" in',
      '  *is-active*) case "$*" in *.socket*) w=$k ;; *) w=$s ;; esac; case "$*" in *--quiet*) ;; *) echo "$w" ;; esac; [ "$w" = active ] && exit 0; exit 3 ;;',
      '  *disable*|*" stop "*) set_to inactive "$*" ;;',
      `  *" start "*|*--now*) set_to active "$*" ;;`,
      `  *" restart "*) if [ -e '${unitState}' ]; then echo active > '${unitState}'; fi ;;`,
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeBin, "systemctl"), 0o755);
  writeFileSync(join(fakeBin, "claude"), `#!/bin/sh\necho "$*" >> '${claudeLog}'\nexit 0\n`);
  chmodSync(join(fakeBin, "claude"), 0o755);

  const runner: Runner = (cmd) => {
    const result = Bun.spawnSync(cmd, {
      env: { PATH: fakeBin },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  };

  // The router's health page, faked: it answers while the fake unit says active.
  const clock = { now: Date.UTC(2026, 9, 15, 12, 0, 0) };
  const probe: HealthProbe = {
    fetch: async () => {
      const state = existsSync(unitState) ? readFileSync(unitState, "utf8").trim() : "inactive";
      if (state === "active") return Response.json({ ok: true, port: PORT });
      throw Object.assign(new TypeError("Unable to connect."), { code: "ConnectionRefused" });
    },
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  };

  const questions: string[] = [];
  const answers: boolean[] = [];
  const options = (overrides: Partial<MigrateOptions> = {}): MigrateOptions => ({
    dryRun: false,
    yes: false,
    bunPath: process.execPath,
    bunVersion: Bun.version,
    bundle: join(import.meta.dir, "..", "..", "plugin", "dist", "router.js"),
    instructionsSource: join(import.meta.dir, "..", "..", "plugin", "instructions"),
    runner,
    systemd: true,
    // The terminal: it records each question and answers what the test queued (yes by default).
    confirm: (question) => {
      questions.push(question);
      return answers.shift() ?? true;
    },
    probe,
    env: { HOME: home, CLAUDE_CONFIG_DIR: configDir },
    ...overrides,
  });

  const run = (overrides: Partial<MigrateOptions> = {}) => runMigrate(paths, options(overrides));
  const restore = (overrides: Partial<Parameters<typeof runRestore>[1]> = {}) =>
    runRestore(paths, {
      yes: true,
      now: false,
      runner,
      systemd: true,
      confirm: null,
      probe,
      ...overrides,
    });
  const claudeCalls = () => (existsSync(claudeLog) ? readFileSync(claudeLog, "utf8") : "");
  const systemctlCalls = () => (existsSync(systemctlLog) ? readFileSync(systemctlLog, "utf8") : "");

  return {
    home,
    configDir,
    paths,
    settingsFile,
    claudeMd,
    fakeBin,
    questions,
    answer: (yes: boolean) => answers.push(yes),
    claudeCalls,
    systemctlCalls,
    run,
    restore,
    old: {
      configDir: oldConfigDir,
      stateDir: oldStateDir,
      shareDir: oldShareDir,
      stateHomeDir: oldStateHomeDir,
      launcher: oldLauncher,
      unitFile: oldUnitFile,
      socketFile: oldSocketFile,
      routerCopy: oldRouterCopy,
    },
    new: {
      configDir: paths.gatewayConfigFile.replace("/gateway.json", ""),
      stateDir: paths.stateDir,
      shareDir: join(home, ".local", "share", "cc-smart-dev-kit"),
      stateHomeDir: join(home, ".local", "state", "cc-smart-dev-kit"),
      launcher: join(home, ".local", "bin", "cc-smart-dev-kit"),
      unitFile: paths.routerUnitFile,
      socketFile: paths.routerSocketFile,
      routerCopy: paths.routerCopy,
    },
  };
}

/** Everything the full move must produce, checked by several tests. */
function expectMoved(m: ReturnType<typeof machine>): void {
  // The folders moved, and the old ones are gone.
  for (const path of [
    m.old.configDir,
    m.old.stateDir,
    m.old.shareDir,
    m.old.stateHomeDir,
    m.old.launcher,
  ]) {
    expect(existsSync(path)).toBe(false);
  }
  expect(existsSync(m.new.launcher)).toBe(true);
  expect(readJson(join(m.new.configDir, "jobs.json"))).toEqual({ reserveGb: 20 });
  expect(readFileSync(join(m.new.stateHomeDir, "gateway-state.json"), "utf8")).toContain(
    '"cc-smart-dev-kit-opus"',
  );
  expect(statSync(join(m.new.configDir, "gateway.json")).mode & 0o777).toBe(0o600);
}

describe("migrate", () => {
  test("--dry-run: every step printed, and nothing written, run or stopped", async () => {
    const m = machine();
    const before = readFileSync(m.settingsFile, "utf8");
    expect(await m.run({ dryRun: true })).toBe(0);
    expect(printed.join("\n")).toContain(`moved from ~/.config/${OLD.name}`);
    expect(printed.join("\n")).toContain("Dry run: nothing was written, run or stopped.");
    expect(printed.join("\n")).toContain(OLD.unit);
    expect(printed.join("\n")).toContain(`claude plugin uninstall ${OLD.pluginId}`);
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.new.configDir)).toBe(false);
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
    expect(readFileSync(m.settingsFile, "utf8")).toBe(before);
    expect(m.systemctlCalls()).toBe("");
    expect(m.claudeCalls()).toBe("");
    expect(m.questions).toEqual([]);
  });

  test("a full move: folders, records, backups, settings, instructions, gateway, units, uninstall", async () => {
    const m = machine();
    expect(await m.run({ yes: true })).toBe(0);
    expectMoved(m);

    // The settings: this version's values, and nothing else touched.
    const settings = readJson(m.settingsFile);
    expect(settings.env).toEqual(gatewayEnv(PORT));
    expect(settings.model).toBe("opus");
    expect(settings.extraKnownMarketplaces[OLD.marketplace]).toBeDefined();

    // The instructions block: the new markers, the new import path, my own text kept.
    const claudeMd = readFileSync(m.claudeMd, "utf8");
    expect(claudeMd).toContain("<!-- cc-smart-dev-kit:begin -->");
    expect(claudeMd).toContain("@~/.claude/cc-smart-dev-kit/instructions/core.md");
    expect(claudeMd).toContain("Text of my own, after the block.");
    expect(claudeMd).not.toContain(OLD.name);

    // The gateway config: the slots renamed, an alias for each old name, the model slots
    // renamed, the proof left alone (the judge test has to run again), mode 600.
    const config = readJson(m.paths.gatewayConfigFile);
    expect(Object.keys(config.slots)).toEqual([
      "cc-smart-dev-kit-judge",
      "cc-smart-dev-kit-opus",
      "cc-smart-dev-kit-scout",
      "cc-smart-dev-kit-worker",
    ]);
    expect(config.aliases).toEqual({
      [`${OLD.name}-judge`]: "cc-smart-dev-kit-judge",
      [`${OLD.name}-opus`]: "cc-smart-dev-kit-opus",
      [`${OLD.name}-scout`]: "cc-smart-dev-kit-scout",
      [`${OLD.name}-worker`]: "cc-smart-dev-kit-worker",
    });
    expect(config.modelSlots).toEqual({ "claude-opus-5-5": "cc-smart-dev-kit-opus" });

    // The old router units: stopped, disabled, removed; this version's in their place.
    expect(m.systemctlCalls()).toContain(`--user disable ${OLD.socket} ${OLD.unit}`);
    expect(m.systemctlCalls()).toContain(`--user stop --no-block ${OLD.socket} ${OLD.unit}`);
    expect(existsSync(m.old.unitFile)).toBe(false);
    expect(existsSync(m.old.socketFile)).toBe(false);
    expect(readFileSync(m.new.unitFile, "utf8")).toContain("cc-smart-dev-kit-router");
    expect(readFileSync(m.new.routerCopy, "utf8")).toBe(
      readFileSync(join(import.meta.dir, "..", "..", "plugin", "dist", "router.js"), "utf8"),
    );

    // The records and the backups now name this version's files.
    const changed = readJson(join(m.new.stateDir, "changed.json"));
    const files = Object.keys(changed.files);
    expect(files.some((file) => file.includes(`/anymodel`))).toBe(false);
    expect(files).toContain(m.new.launcher);
    for (const entry of Object.values(changed.files) as { baseline: string | null }[]) {
      expect(entry.baseline ?? "").not.toContain(`${OLD.backupInfix}`);
    }
    // A recorded baseline still points at a backup `listBackups` can find: that is what
    // `restore` looks up before it puts a file back.
    const recorded = readJson(join(m.new.stateDir, "changed.json")).files[m.settingsFile];
    expect(recorded.baseline).toBeDefined();
    expect(listBackups(m.new.stateDir, m.settingsFile).map((one) => one.path)).toContain(
      recorded.baseline,
    );
    const backupFolders = readdirSync(join(m.new.stateDir, "backups"));
    expect(backupFolders.some((name) => decodeURIComponent(name).includes(OLD.name))).toBe(false);
    const launcherBackups = backupFolders.find((name) =>
      decodeURIComponent(name).endsWith(m.new.launcher),
    );
    expect(launcherBackups).toBeDefined();
    const names = readdirSync(join(m.new.stateDir, "backups", launcherBackups ?? ""));
    // The old launcher's own backup, renamed (both the file's name and the infix), and the
    // backup this version's write made.
    expect(names).toContain(`cc-smart-dev-kit.bak-cc-smart-dev-kit-${STAMP}.absent`);
    expect(names.some((name) => name.includes(OLD.name))).toBe(false);

    // The old plugin: told, and taken out after the terminal yes.
    expect(m.questions).toEqual(["Uninstall the old plugin now?"]);
    expect(m.claudeCalls()).toBe(
      `plugin uninstall ${OLD.pluginId}\nplugin marketplace remove ${OLD.marketplace}\n`,
    );
  });

  test("a second run: nothing to move, and nothing changes", async () => {
    const m = machine();
    await m.run({ yes: true });
    const settings = readFileSync(m.settingsFile, "utf8");
    const config = readFileSync(m.paths.gatewayConfigFile, "utf8");
    printed.length = 0;
    expect(await m.run({ yes: true })).toBe(0);
    expect(printed).toEqual(["Nothing to move."]);
    expect(readFileSync(m.settingsFile, "utf8")).toBe(settings);
    expect(readFileSync(m.paths.gatewayConfigFile, "utf8")).toBe(config);
  });

  test("a gateway config others can read: stops before anything is moved", async () => {
    const m = machine();
    chmodSync(join(m.old.configDir, "gateway.json"), 0o644);
    // The command turns this into one error line and exit 1; nothing has moved yet.
    await expect(m.run({})).rejects.toThrow("can be read by other users");
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
  });

  test("a target that already exists: stops before anything, and never merges", async () => {
    const m = machine();
    mkdirSync(join(m.home, ".config", "cc-smart-dev-kit"), { recursive: true });
    expect(await m.run({})).toBe(1);
    expect(printed.join("\n")).toContain("is already there");
    expect(printed.join("\n")).toContain("never merged");
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(m.questions).toEqual([]);
  });

  test("inside a Claude Code session: refused, and nothing moved", async () => {
    const m = machine();
    expect(await m.run({ env: { CLAUDECODE: "1" } })).toBe(1);
    expect(printed.join("\n")).toContain("cannot run inside a Claude Code session");
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
  });

  test("the new plugin is not installed: the install commands, and nothing moved", async () => {
    const m = machine();
    writeFileSync(
      join(m.configDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { [OLD.pluginId]: [{ scope: "user", installPath: m.home }] } }),
    );
    expect(await m.run({})).toBe(1);
    expect(printed.join("\n")).toContain(`claude plugin marketplace add ${MARKETPLACE_SOURCE}`);
    expect(printed.join("\n")).toContain("claude plugin install cc-smart-dev-kit@cc-smart-dev-kit");
    expect(existsSync(m.old.launcher)).toBe(true);
  });

  test("restore after migrate: takes out what the old setup added, and keeps the rest", async () => {
    const m = machine();
    await m.run({ yes: true });
    expect(await m.restore({ now: true })).toBe(0);
    const settings = readJson(m.settingsFile);
    // Its keys are gone; the file, and everything else in it, stays.
    expect(settings.env).toEqual({});
    expect(settings.model).toBe("opus");
    expect(settings.autoMode).toEqual({ environment: ["$defaults"] });
    expect(readFileSync(m.claudeMd, "utf8")).not.toContain("cc-smart-dev-kit:begin");
    expect(readFileSync(m.claudeMd, "utf8")).toContain("Text of my own, after the block.");
    expect(existsSync(m.new.launcher)).toBe(false);
    expect(existsSync(m.new.unitFile)).toBe(false);
    expect(existsSync(m.new.socketFile)).toBe(false);
    expect(existsSync(m.new.routerCopy)).toBe(false);
    expect(existsSync(join(m.new.stateDir, "instructions"))).toBe(false);
    // The gateway config is the person's own: restore leaves it as it is.
    expect(readJson(m.paths.gatewayConfigFile).slots["cc-smart-dev-kit-scout"]).toBeDefined();
  });

  test("a key the person changed stays theirs, and an old name they wrote is said, not changed", async () => {
    const m = machine();
    const settings = readJson(m.settingsFile);
    settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "claude-sonnet-5-5";
    settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "anymodel-scout[1m]"; // theirs: not in owned.json
    writeFileSync(m.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    const owned = readJson(join(m.old.stateDir, "owned.json"));
    owned[realTarget(m.settingsFile)] = owned[realTarget(m.settingsFile)].filter(
      (record: { path: string[] }) => record.path[1] !== "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    );
    writeFileSync(join(m.old.stateDir, "owned.json"), `${JSON.stringify(owned, null, 2)}\n`);
    expect(await m.run({ yes: true })).toBe(0);
    const after = readJson(m.settingsFile);
    expect(after.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5-5");
    expect(after.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("anymodel-scout[1m]");
    expect(printed.join("\n")).toContain(
      "env.ANTHROPIC_DEFAULT_HAIKU_MODEL still names an old slot, and it is not this plugin's to change",
    );
  });

  test("a router that is running: asked first, and left alone on a no", async () => {
    const m = machine();
    writeFileSync(join(m.home, "unit-state"), "active\n");
    m.answer(false); // the router: left as it is
    m.answer(false); // the old plugin: left installed
    expect(await m.run()).toBe(0);
    expect(m.questions).toEqual([
      `Stop ${OLD.unit} and start cc-smart-dev-kit-router.service?`,
      "Uninstall the old plugin now?",
    ]);
    expect(existsSync(m.old.unitFile)).toBe(true);
    expect(m.systemctlCalls()).not.toContain("disable");
    expect(m.claudeCalls()).toBe("");
  });
});
