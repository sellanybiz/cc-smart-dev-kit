/**
 * `cc-smart-dev-kit migrate`: a temp HOME holding a machine that ran the old `anymodel`
 * names — its folders, its state folder's records and backups, its settings keys, its
 * instructions block, its gateway config and its router units — with a fake `systemctl`
 * and a fake `claude` on PATH, and a fake health probe. No real port, no real plugin, no
 * real machine.
 *
 * The fixture is built with the OLD paths and names on purpose: it is what the old version
 * left behind. This file and `migrate.ts` are the only code that may name them.
 *
 * Two shapes, both from a real machine:
 *   - the default, `0.2.1`: exactly what the one machine that ran 0.2.1 has — no socket
 *     unit at all, `aliases` written by another tool (`sab-scout` → `anymodel-scout`), only
 *     the four gateway keys of the old setup's, and no instructions block yet;
 *   - `build: "dev"`: the later 0.3.0 development build, which already had its socket
 *     unit, the full gateway env, the instructions block and its copy.
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
import { join, relative } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { loadConfigFile } from "../gateway/config";
import type { HealthProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { gatewayEnv } from "../gateway/settings";
import { processStartTime } from "../setup/lock";
import { backupDir, listBackups, realTarget } from "../setup/write";
import { capturePrinted, printed } from "../testing/fake-machine";
import { tempDir } from "../testing/temp";
import {
  BOOKKEEPING_NAMES,
  MIGRATE_STEPS,
  type MigrateOptions,
  type MigrateStep,
  OLD,
  oldGatewayEnv,
  progressFile,
  readOldConfig,
  runMigrate,
} from "./migrate";
import { cliPaths } from "./paths";
import { runRestore } from "./restore";

capturePrinted();

const PORT = 20151;
const STAMP = "20261015T101010101Z";
const RULE = "In my-app: never touch the production database.";
/** The two names the tool that wrote this machine's aliases used. */
const SAB = "sab-scout";
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

interface FixtureOptions {
  /** `dev`: the later 0.3.0 development build's shape. Default: the real 0.2.1 machine. */
  build?: "0.2.1" | "dev";
  /** The old router's unit runs now (the real machine's is active and enabled). */
  routerRunning?: boolean;
  /** The old router keeps answering its health page this many probes after the stop. */
  oldStopsAfter?: number;
  /** The old plugin is not in `installed_plugins.json` (it was taken out already). */
  oldPluginGone?: boolean;
}

/** A temp HOME as the old version left it. */
function machine(fixture: FixtureOptions = {}) {
  const build = fixture.build ?? "0.2.1";
  const dev = build === "dev";
  const home = tempDir("migrate");
  const configDir = join(home, ".claude");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  const systemd = join(home, ".config", "systemd", "user");
  const unitState = join(home, ".unit-state");
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
  // The machine's gateway keys: everything the old `gateway on` wrote (the dev build), or
  // only the four the real 0.2.1 machine holds.
  const envKeys = dev
    ? Object.keys(oldGatewayEnv(PORT))
    : [
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
      ];
  const settingsEnv = Object.fromEntries(
    envKeys.map((key) => [key, oldGatewayEnv(PORT)[key] ?? ""]),
  );

  // ─── The settings the old setup wrote ───
  const settings = {
    model: "opus",
    env: settingsEnv,
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
        ...(fixture.oldPluginGone === true
          ? {}
          : {
              [OLD.pluginId]: [
                { scope: "user", installPath: join(home, "old-plugin"), version: "0.2.1" },
              ],
            }),
        "cc-smart-dev-kit@cc-smart-dev-kit": [
          { scope: "user", installPath: join(home, "new-plugin"), version: VERSION },
        ],
      },
    }),
  );

  // ─── The instructions: the dev build's block and copy; the 0.2.1 machine has none ───
  if (dev) {
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
  } else {
    writeFileSync(claudeMd, "# My notes\n\nText of my own, and no block at all.\n");
  }

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
  if (dev) writeFileSync(oldSocketFile, "# the old socket\n");
  mkdirSync(unitState, { recursive: true });
  if (fixture.routerRunning !== false) writeFileSync(join(unitState, OLD.unit), "active");
  if (dev) writeFileSync(join(unitState, OLD.socket), "active");

  const settingsReal = realTarget(settingsFile);
  const claudeMdReal = realTarget(claudeMd);
  const unitReal = realTarget(oldUnitFile);
  const socketReal = realTarget(oldSocketFile);
  const copyReal = realTarget(oldRouterCopy);
  const backup = (file: string, name: string) => join(backupDir(oldStateDir, file), name);
  mkdirSync(backupDir(oldStateDir, settingsFile), { recursive: true });
  writeFileSync(backup(settingsFile, `settings.json${OLD.backupInfix}${STAMP}`), "{}\n");
  // The launcher did not exist before the old setup: its baseline is an `.absent` marker.
  mkdirSync(backupDir(oldStateDir, oldLauncher), { recursive: true });
  writeFileSync(backup(oldLauncher, `${OLD.name}${OLD.backupInfix}${STAMP}.absent`), "");
  mkdirSync(backupDir(oldStateDir, oldUnitFile), { recursive: true });
  writeFileSync(backup(oldUnitFile, `${OLD.unit}${OLD.backupInfix}${STAMP}.absent`), "");
  mkdirSync(backupDir(oldStateDir, oldRouterCopy), { recursive: true });
  writeFileSync(backup(oldRouterCopy, `router.js${OLD.backupInfix}${STAMP}.absent`), "");
  const changedFiles: Record<string, unknown> = {
    [launcherReal]: {
      kinds: ["whole-file"],
      baseline: backup(oldLauncher, `${OLD.name}${OLD.backupInfix}${STAMP}.absent`),
    },
    [settingsReal]: {
      kinds: ["json-keys", "json-entries"],
      baseline: backup(settingsFile, `settings.json${OLD.backupInfix}${STAMP}`),
    },
    [unitReal]: {
      kinds: ["whole-file"],
      baseline: backup(oldUnitFile, `${OLD.unit}${OLD.backupInfix}${STAMP}.absent`),
    },
    [copyReal]: {
      kinds: ["whole-file"],
      baseline: backup(oldRouterCopy, `router.js${OLD.backupInfix}${STAMP}.absent`),
    },
  };
  if (dev) {
    const coreReal = realTarget(join(oldStateDir, "instructions", "core.md"));
    mkdirSync(backupDir(oldStateDir, claudeMd), { recursive: true });
    writeFileSync(backup(claudeMd, `CLAUDE.md${OLD.backupInfix}${STAMP}`), "# My notes\n");
    mkdirSync(backupDir(oldStateDir, oldSocketFile), { recursive: true });
    writeFileSync(backup(oldSocketFile, `${OLD.socket}${OLD.backupInfix}${STAMP}.absent`), "");
    mkdirSync(backupDir(oldStateDir, join(oldStateDir, "instructions", "core.md")), {
      recursive: true,
    });
    writeFileSync(backup(coreReal, `core.md${OLD.backupInfix}${STAMP}.absent`), "");
    changedFiles[claudeMdReal] = {
      kinds: ["markdown-block"],
      baseline: backup(claudeMd, `CLAUDE.md${OLD.backupInfix}${STAMP}`),
    };
    changedFiles[socketReal] = {
      kinds: ["whole-file"],
      baseline: backup(oldSocketFile, `${OLD.socket}${OLD.backupInfix}${STAMP}.absent`),
    };
    changedFiles[coreReal] = {
      kinds: ["whole-file"],
      baseline: backup(coreReal, `core.md${OLD.backupInfix}${STAMP}.absent`),
    };
  }

  writeFileSync(
    join(oldStateDir, "owned.json"),
    `${JSON.stringify(
      {
        [settingsReal]: envKeys.map((key) => ({
          path: ["env", key],
          value: oldGatewayEnv(PORT)[key],
        })),
        ...(dev ? { [claudeMdReal]: [{ path: ["x"], value: 1 }] } : {}),
      },
      null,
      2,
    )}\n`,
  );
  if (dev) {
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
  }
  writeFileSync(
    join(oldStateDir, "changed.json"),
    `${JSON.stringify({ files: changedFiles }, null, 2)}\n`,
  );

  // ─── The gateway config (mode 600) and the machine's job settings ───
  mkdirSync(oldConfigDir, { recursive: true });
  writeFileSync(
    join(oldConfigDir, "gateway.json"),
    `${JSON.stringify(
      {
        aliases: dev ? {} : { [SAB]: `${OLD.name}-scout`, "sab-worker": `${OLD.name}-worker` },
        anthropicBaseUrl: "https://api.anthropic.com",
        backends: {
          omniroute: { apiKey: "sk-test-key-0123456789abcdef", baseUrl: "http://127.0.0.1:20128" },
        },
        ...(dev ? { judgeTested: { "omniroute:glm-5.3-flash": "a-proof" } } : {}),
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
  writeFileSync(join(oldConfigDir, "moved-from-sab-ai"), "2026-09-01T00:00:00Z\n");
  writeFileSync(join(home, ".tmux.conf"), `set -g allow-passthrough all\n`);

  // ─── A fake systemctl, and a fake claude, alone on the runner's PATH ───
  const fakeBin = join(home, "fake-bin");
  mkdirSync(fakeBin);
  const systemctlLog = join(home, "systemctl.log");
  const claudeLog = join(home, "claude.log");
  const unitStateOf = (name: string) =>
    existsSync(join(unitState, name))
      ? readFileSync(join(unitState, name), "utf8").trim()
      : "inactive";
  // Like the real one: a unit whose file is not there is not "active" (exit 4), and
  // `disable`/`stop` on it fail with "Unit … does not exist" (exit 1). A 0.2.1 machine has
  // no socket unit, and that must never fail a move.
  writeFileSync(
    join(fakeBin, "systemctl"),
    [
      "#!/bin/sh",
      `echo "$*" >> '${systemctlLog}'`,
      `units='${systemd}'`,
      `state='${unitState}'`,
      'named() { n=\'\'; for a in "$@"; do case "$a" in *.service|*.socket) n=$a ;; esac; done; echo "$n"; }',
      "missing() {",
      '  for a in "$@"; do',
      '    case "$a" in *.service|*.socket) [ -f "$units/$a" ] || { echo "$a"; return 0; } ;; esac',
      "  done",
      "  return 1",
      "}",
      "put() {",
      '  for a in "$@"; do',
      '    case "$a" in *.service|*.socket) echo "$1" > "$state/$a" ;; esac',
      "  done",
      "}",
      'case "$*" in',
      "  *is-active*)",
      '    n=$(named "$@")',
      '    [ -f "$units/$n" ] || exit 4',
      '    w=inactive; [ -f "$state/$n" ] && read w < "$state/$n"',
      '    case "$*" in *--quiet*) ;; *) echo "$w" ;; esac',
      '    [ "$w" = active ] && exit 0',
      "    exit 3 ;;",
      '  *" disable "*)',
      '    m=$(missing "$@"); [ -n "$m" ] && { echo "Failed to disable unit: Unit $m does not exist" >&2; exit 1; }',
      '    put inactive "$@" ;;',
      '  *" stop "*)',
      '    m=$(missing "$@"); [ -n "$m" ] && { echo "Failed to stop unit: Unit $m does not exist" >&2; exit 1; }',
      // `--no-block`: the unit is deactivating while its router drains, as systemd shows it.
      '    put deactivating "$@" ;;',
      '  *" start "*|*--now*) put active "$@" ;;',
      '  *" restart "*) for a in "$@"; do case "$a" in *.service) [ -f "$state/$a" ] && echo active > "$state/$a" ;; esac; done ;;',
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

  // The routers' health pages, faked: the old router answers only the old path, and only
  // while its unit runs (deactivating: while its drain lasts, `oldStopsAfter` probes); this
  // version's answers its own path while its unit is active.
  const clock = { now: Date.UTC(2026, 9, 15, 12, 0, 0) };
  const probes: string[] = [];
  // The units the probe follows. A test may point a run at throwaway units (the table in
  // `run` below), and then those are the units whose routers answer.
  const probeUnits: { new: string; old: string } = {
    new: "cc-smart-dev-kit-router.service",
    old: OLD.unit,
  };
  let oldDrain = fixture.oldStopsAfter ?? 0;
  const refused = () =>
    Object.assign(new TypeError("Unable to connect."), { code: "ConnectionRefused" });
  const probe: HealthProbe = {
    fetch: async (url: string) => {
      probes.push(url);
      if (url.endsWith(OLD.healthPath)) {
        const state = unitStateOf(probeUnits.old);
        if (state === "active") return Response.json({ ok: true, port: PORT });
        if (state === "deactivating" && oldDrain > 0) {
          oldDrain -= 1;
          return Response.json({ ok: true, port: PORT });
        }
        throw refused();
      }
      const state = unitStateOf(probeUnits.new);
      if (state === "active") return Response.json({ ok: true, port: PORT });
      throw refused();
    },
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  };

  const questions: string[] = [];
  const answers: boolean[] = [];
  let breakOn: MigrateStep | null = null;
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
    onStepDone: (step) => {
      if (breakOn === step) throw new Error(`the test breaks the run after ${step}`);
    },
    ...overrides,
  });

  const run = (overrides: Partial<MigrateOptions> = {}) => {
    // A run pointed at throwaway units (the table) has those units' routers answering.
    const named = overrides.router?.units;
    if (named?.oldUnit !== undefined) probeUnits.old = named.oldUnit;
    if (named?.unit !== undefined) probeUnits.new = named.unit;
    return runMigrate(paths, options(overrides));
  };
  const restore = (overrides: Partial<Parameters<typeof runRestore>[1]> = {}) =>
    runRestore(paths, {
      yes: true,
      now: false,
      cliBundle: join(import.meta.dir, "..", "..", "plugin", "dist", "cli.js"),
      runner,
      service: "systemd",
      confirm: null,
      probe,
      ...overrides,
    });
  const claudeCalls = () => (existsSync(claudeLog) ? readFileSync(claudeLog, "utf8") : "");
  const systemctlCalls = () => (existsSync(systemctlLog) ? readFileSync(systemctlLog, "utf8") : "");
  // The calls that change something: a dry run and a refused run may only read (`is-active`).
  const systemctlChanges = () =>
    systemctlCalls()
      .split("\n")
      .filter((line) => /disable|stop|start|restart|enable|reset-failed|daemon-reload/.test(line))
      .join("\n");

  return {
    build,
    home,
    configDir,
    paths,
    settingsFile,
    claudeMd,
    fakeBin,
    questions,
    answer: (yes: boolean) => answers.push(yes),
    /** The next run fails right after this step, as a crash there would. */
    breakOn: (step: MigrateStep) => {
      breakOn = step;
    },
    claudeCalls,
    systemctlCalls,
    systemctlChanges,
    probes: () => probes,
    unitState: unitStateOf,
    setUnitState: (name: string, state: string) => writeFileSync(join(unitState, name), state),
    setOldDrain: (polls: number) => {
      oldDrain = polls;
    },
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

/** The steps a run says it will do, or did: the list between `steps: ` and the full stop. */
function stepsOf(output: string): string[] {
  const line = output.split("\n").find((one) => /(?:steps|Steps): /.test(one));
  return (line ?? "")
    .replace(/^.*steps: /i, "")
    .replace(/\.$/, "")
    .split(", ");
}

/**
 * Every file under `home`, for two machines to be compared after two runs. Two things differ
 * between two machines' files, and neither is the move's doing: the temp folder's own name —
 * inside the paths the records and the unit files hold, and inside a backup folder's name,
 * which is the file's real path, encoded — and the moment a backup was made (its own name,
 * and the baselines that hold it).
 */
function snapshot(home: string): Record<string, string> {
  const flatten = (text: string): string =>
    text
      .replaceAll(encodeURIComponent(home), "~")
      .replaceAll(home, "~")
      // The stamp goes, and its counter (two backups in the same millisecond) stays: a run
      // that made one backup more is still a difference.
      .replaceAll(/(\d{8}T\d{9}Z)(-\d+)?/g, "STAMP$2");
  /** The name a file is ordered by: the same, with the stamp left in it. */
  const orderKey = (rel: string): string =>
    rel.replaceAll(encodeURIComponent(home), "~").replaceAll(home, "~");
  const found: { key: string; order: string; value: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(home, path);
      // The harness, not the machine: the fakes and their logs, and the units' fake states.
      if (rel === "fake-bin" || rel === ".unit-state" || rel.endsWith(".log")) continue;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      found.push({
        key: flatten(rel),
        order: orderKey(rel),
        value: flatten(readFileSync(path, "utf8")),
      });
    }
  };
  walk(home);
  // Two backups of one file, made at different moments, carry different stamps and so are
  // the same key once the stamp is gone — the old machine's backup and this run's, say.
  // Which of them a plain map keeps would then be whichever `readdirSync` walked last: the
  // folder's creation order on tmpfs, a name hash on ext4, which depends on the stamp and
  // so changes with the clock. The oldest name keeps the plain key and the others are
  // numbered, so the same run always reads the same on any machine.
  const files: Record<string, string> = {};
  const byName = found.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  for (const entry of byName) {
    let key = entry.key;
    for (let n = 2; Object.hasOwn(files, key); n += 1) key = `${entry.key}#${String(n)}`;
    files[key] = entry.value;
  }
  return files;
}

describe("migrate — the real 0.2.1 machine", () => {
  test("the whole move: no socket unit, no crash, and the config parses", async () => {
    const m = machine();
    expect(await m.run({ yes: true })).toBe(0);
    expectMoved(m);

    // The folder move carries what is not ours too (the marker an older move left).
    expect(readFileSync(join(m.new.configDir, "moved-from-sab-ai"), "utf8")).toContain(
      "2026-09-01",
    );

    // C1: the old socket unit never existed, and stopping it must not fail the move. The
    // fake systemctl fails on a missing unit exactly as the real one does.
    expect(m.systemctlCalls()).toContain(`--user disable ${OLD.unit}`);
    expect(m.systemctlCalls()).not.toContain(OLD.socket);
    // Never even asked for a unit that is not there: the run's own lines stay clean.
    expect(printed.join("\n")).not.toContain("does not exist");
    expect(printed.join("\n")).not.toContain("failed (exit");
    expect(existsSync(m.old.unitFile)).toBe(false);
    expect(readFileSync(m.new.unitFile, "utf8")).toContain("cc-smart-dev-kit-router");
    expect(readFileSync(m.new.socketFile, "utf8")).toContain("127.0.0.1:20151");
    expect(printed.join("\n")).not.toContain("step failed");

    // C2: the aliases another tool wrote now point at this version's slots, and the whole
    // config this version's own reader accepts.
    const config = loadConfigFile(m.paths.gatewayConfigFile);
    expect(config.aliases[SAB]).toBe("cc-smart-dev-kit-scout");
    expect(config.aliases["sab-worker"]).toBe("cc-smart-dev-kit-worker");
    expect(config.aliases[`${OLD.name}-scout`]).toBe("cc-smart-dev-kit-scout");
    expect(Object.keys(config.slots)).toEqual([
      "cc-smart-dev-kit-judge",
      "cc-smart-dev-kit-opus",
      "cc-smart-dev-kit-scout",
      "cc-smart-dev-kit-worker",
    ]);

    // The settings keys the old setup owned: the ones this version writes hold its value,
    // and its model keys, which it no longer writes (0.5.0), are gone.
    const settings = readJson(m.settingsFile);
    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION).toBeUndefined();
    expect(settings.model).toBe("opus");

    // No instructions block was there, and none was added: that is `setup`'s job, and the
    // closing lines say so (0.2.x shipped no instructions, so `migrateInstructions` had
    // nothing to rewrite).
    expect(readFileSync(m.claudeMd, "utf8")).toBe(
      "# My notes\n\nText of my own, and no block at all.\n",
    );
    expect(printed.join("\n")).toContain(
      "\nThis machine had no instructions block, so this move installed none. Run cc-smart-dev-kit setup: it installs them, and refreshes the launcher and the companions.",
    );

    // The records and the backups name this version's files.
    const changed = changedFilesOf(m);
    expect(Object.keys(changed).some((file) => file.includes(`/${OLD.name}`))).toBe(false);
    expect(Object.keys(changed)).toContain(m.new.launcher);
    expect(Object.keys(changed)).toContain(m.new.unitFile);

    // A second run has nothing to do.
    printed.length = 0;
    expect(await m.run({ yes: true })).toBe(0);
    expect(printed).toEqual(["Nothing to move."]);
  });

  test("a run that fails after every step continues where it left off, and ends the same as a clean run", async () => {
    const clean = machine();
    expect(await clean.run({ yes: true })).toBe(0);
    const expected = snapshot(clean.home);

    for (const step of MIGRATE_STEPS) {
      const m = machine();
      m.breakOn(step);
      // The failure is said, and the run stops with 1 — nothing else is thrown out.
      expect(await m.run({ yes: true })).toBe(1);
      const broke = printed.join("\n");
      expect(broke).toContain(`! the ${step} step failed`);
      expect(broke).toContain("Run cc-smart-dev-kit migrate again");
      expect(broke).toContain("the test breaks the run after");
      // The next run (a person runs it again) finishes the move.
      printed.length = 0;
      expect(await m.run({ yes: true })).toBe(0);
      expect(snapshot(m.home)).toEqual(expected);
    }
  });

  test("a dry run lists the same steps a real run does", async () => {
    const dry = machine();
    expect(await dry.run({ dryRun: true })).toBe(0);
    const dryOutput = printed.join("\n");
    const planned = stepsOf(dryOutput);
    // Nothing was written, and the questions were not asked.
    expect(existsSync(dry.old.configDir)).toBe(true);
    expect(existsSync(dry.new.stateDir)).toBe(false);
    expect(dry.questions).toEqual([]);
    expect(dry.systemctlChanges()).toBe("");
    expect(printed.join("\n")).toContain("Dry run: nothing was written, run or stopped.");

    printed.length = 0;
    const real = machine();
    expect(await real.run({ yes: true })).toBe(0);
    const realOutput = printed.join("\n");
    expect(planned).toEqual(stepsOf(realOutput));
    expect(planned).toEqual([...MIGRATE_STEPS]);
    // And it says the same thing about every file it would change: a dry run reads the old
    // state folder (the records, the markers), exactly as a real run does after its move.
    // The router's own step says what it would do in other words (it installs through the
    // gateway's path): its line is left to the steps list above.
    const changes = (output: string) =>
      output.split("\n").filter((line) => /^[+~] /.test(line) && !line.includes("/systemd/user/"));
    expect(changes(dryOutput)).toEqual(changes(realOutput));
    // The dry run says what a real run would ask, too.
    expect(dryOutput).toContain(`would ask: Stop ${OLD.unit} and start`);
  });

  test("a no to the router question moves nothing at all", async () => {
    const m = machine();
    m.answer(false);
    expect(await m.run()).toBe(1);
    expect(m.questions).toEqual([`Stop ${OLD.unit} and start cc-smart-dev-kit-router.service?`]);
    expect(printed.join("\n")).toContain("Nothing was moved");
    // Not a file, not a folder, not a systemctl call, not a question more.
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.old.stateDir)).toBe(true);
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
    expect(existsSync(m.new.unitFile)).toBe(false);
    expect(m.systemctlChanges()).toBe("");
    expect(m.claudeCalls()).toBe("");
  });

  test("no terminal, and no --yes: nothing is moved either", async () => {
    const m = machine();
    expect(await m.run({ confirm: null })).toBe(1);
    expect(printed.join("\n")).toContain("Nothing was moved");
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
    expect(m.systemctlChanges()).toBe("");
  });

  test("the old router's own health page is waited for, then this version's units are installed", async () => {
    const m = machine({ oldStopsAfter: 3 });
    expect(await m.run({ yes: true })).toBe(0);
    const asked = m.probes().filter((url) => url.endsWith(OLD.healthPath));
    // It keeps asking the old page until the port is refused, and installs only then.
    expect(asked.length).toBeGreaterThanOrEqual(4);
    expect(m.probes().findIndex((url) => url.endsWith(OLD.healthPath))).toBeLessThan(
      m.probes().findIndex((url) => url.includes("/__cc-smart-dev-kit/health")),
    );
    expect(readFileSync(m.new.unitFile, "utf8")).toContain("cc-smart-dev-kit-router");
  });

  test("an old router that never lets go of its port: the new units are not installed, and the step says so", async () => {
    const m = machine({ oldStopsAfter: Number.POSITIVE_INFINITY });
    expect(await m.run({ yes: true })).toBe(1);
    expect(printed.join("\n")).toContain("! the router step failed");
    expect(printed.join("\n")).toContain("still answers after 15 s");
    expect(existsSync(m.new.unitFile)).toBe(false);
    // Everything before the router is done and kept, and a second run goes on from there.
    expect(existsSync(m.new.launcher)).toBe(true);
    // The router lets go at last (the person stopped it by hand, or it finished draining).
    m.setUnitState(OLD.unit, "inactive");
    m.setOldDrain(0);
    expect(await m.run({ yes: true })).toBe(0);
    expect(existsSync(m.new.unitFile)).toBe(true);
  });

  test("a Claude session that started first made the state folder: the move goes into it", async () => {
    const m = machine();
    // What the new plugin's SessionStart hook writes before anyone runs migrate.
    mkdirSync(join(m.paths.stateDir, "sessions"), { recursive: true });
    writeFileSync(join(m.paths.stateDir, "sessions", "4242.json"), '{"pid":4242}\n');
    writeFileSync(join(m.paths.stateDir, "update-check.json"), '{"result":"skipped"}\n');
    writeFileSync(join(m.paths.stateDir, "update.log"), "a line\n");
    // A held major version (D33): the background check writes it with no command run.
    writeFileSync(join(m.paths.stateDir, "update-major.json"), '{"version":"1.0.0"}\n');
    expect(await m.run({ yes: true })).toBe(0);
    expectMoved(m);
    expect(existsSync(join(m.new.stateDir, "update-major.json"))).toBe(true);
    // The old setup's records are in, and the session's own bookkeeping stays.
    expect(existsSync(join(m.new.stateDir, "owned.json"))).toBe(true);
    expect(existsSync(join(m.new.stateDir, "changed.json"))).toBe(true);
    expect(readFileSync(join(m.new.stateDir, "update.log"), "utf8")).toBe("a line\n");
    expect(existsSync(join(m.new.stateDir, "sessions", "4242.json"))).toBe(true);
  });

  test("a state folder holding anything else: the run stops, and says which folder holds what", async () => {
    const m = machine();
    mkdirSync(join(m.paths.stateDir, "instructions"), { recursive: true });
    writeFileSync(join(m.paths.stateDir, "instructions", "core.md"), "this version's copy\n");
    expect(await m.run({ yes: true })).toBe(1);
    const said = printed.join("\n");
    expect(said).toContain(m.paths.stateDir);
    expect(said).toContain("instructions");
    expect(said).toContain(m.old.stateDir);
    expect(said).toContain("move or remove");
    // Nothing moved, and the questions were never asked.
    expect(existsSync(m.old.stateDir)).toBe(true);
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(m.questions).toEqual([]);
  });

  test("a key the person removed is not put back, and a key they changed stays theirs", async () => {
    const m = machine();
    const settings = readJson(m.settingsFile);
    settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "claude-sonnet-5-5"; // theirs: changed
    settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION = ""; // gone: their own value now
    delete settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL; // removed by hand, record still there
    writeFileSync(m.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    expect(await m.run({ yes: true })).toBe(0);
    const after = readJson(m.settingsFile).env;
    expect(after.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5-5");
    expect(after.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    // Theirs: they changed it to an empty text.
    expect(after.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION).toBe("");
    // Still the old setup's: a model key this version no longer writes, so it goes.
    expect(after.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION).toBeUndefined();
  });

  test("a path of the person's own that carries the old word is not renamed", async () => {
    const m = machine();
    const mine = join(m.home, "notes", `${OLD.name}-todo.md`);
    const changed = readJson(join(m.old.stateDir, "changed.json"));
    changed.files[realTarget(mine)] = { kinds: ["whole-file"], baseline: null };
    writeFileSync(join(m.old.stateDir, "changed.json"), `${JSON.stringify(changed, null, 2)}\n`);
    expect(await m.run({ yes: true })).toBe(0);
    const after = readJson(join(m.new.stateDir, "changed.json"));
    expect(Object.keys(after.files)).toContain(realTarget(mine));
  });

  test("the old plugin is offered only when it is installed", async () => {
    const withPlugin = machine();
    expect(await withPlugin.run({ yes: true })).toBe(0);
    expect(withPlugin.questions).toContain("Uninstall the old plugin now?");
    expect(withPlugin.claudeCalls()).toContain(`plugin uninstall ${OLD.pluginId}`);

    printed.length = 0;
    const gone = machine({ oldPluginGone: true });
    expect(await gone.run({ yes: true })).toBe(0);
    expect(gone.questions).not.toContain("Uninstall the old plugin now?");
    expect(gone.claudeCalls()).toBe("");
    expect(printed.join("\n")).not.toContain(`claude plugin uninstall ${OLD.pluginId}`);
  });

  test("sessions still running the old plugin are named before anything moves", async () => {
    const m = machine();
    // A record the old plugin's SessionStart wrote for this very process: it is alive.
    mkdirSync(join(m.old.stateDir, "sessions"), { recursive: true });
    writeFileSync(
      join(m.old.stateDir, "sessions", `${String(process.pid)}.json`),
      `${JSON.stringify({
        pid: process.pid,
        start: processStartTime(process.pid),
        version: "0.2.1",
      })}\n`,
    );
    expect(await m.run({ yes: true })).toBe(0);
    expect(printed.join("\n")).toContain("started with the old plugin is still running");
    expect(printed.join("\n")).toContain("close it first");
  });

  test("an old name left in a record is still found, after the folders have moved", async () => {
    const m = machine();
    expect(await m.run({ yes: true })).toBe(0);
    // A run that died inside its records step leaves exactly this: this version's folders,
    // and a record that still names an old path — which is not "nothing to move".
    const file = join(m.new.stateDir, "changed.json");
    const changed = readJson(file);
    const mine = join(m.home, ".claude", OLD.name, "settings.json");
    changed.files[mine] = { kinds: ["json-keys"], baseline: null };
    writeFileSync(file, `${JSON.stringify(changed, null, 2)}\n`);
    printed.length = 0;
    expect(await m.run({ yes: true })).toBe(0);
    expect(printed.join("\n")).not.toBe("Nothing to move.");
    expect(Object.keys(readJson(file).files)).not.toContain(mine);
  });

  test("a gateway config this version refuses stops the run before anything moves", async () => {
    const m = machine();
    const file = join(m.old.configDir, "gateway.json");
    const config = readJson(file);
    config.port = 99_999; // not a port: this version's schema refuses it
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    expect(await m.run({ yes: true })).toBe(1);
    expect(printed.join("\n")).toContain("is not a valid gateway config");
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.old.stateDir)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
    expect(m.systemctlChanges()).toBe("");
  });

  test("the units table: a run on throwaway unit names and a free port touches only those", async () => {
    const m = machine();
    const units = {
      oldUnit: "amtest-old-router.service",
      oldSocket: "amtest-old-router.socket",
      unit: "amtest-new-router.service",
      socket: "amtest-new-router.socket",
    };
    const systemd = systemdDir(m.home);
    writeFileSync(join(systemd, units.oldUnit), "# the throwaway unit\n");
    m.setUnitState(units.oldUnit, "active");
    expect(await m.run({ yes: true, router: { units, port: 20152 } })).toBe(0);
    expect(m.systemctlCalls()).toContain("amtest-old-router.service");
    expect(m.systemctlCalls()).not.toContain(OLD.unit);
    expect(existsSync(join(systemd, units.unit))).toBe(true);
    expect(existsSync(m.new.unitFile)).toBe(false);
    expect(readFileSync(join(systemd, units.socket), "utf8")).toContain("127.0.0.1:20152");
  });
});

describe("migrate — the later 0.3.0 development build", () => {
  test("--dry-run: every step printed, and nothing written, run or stopped", async () => {
    const m = machine({ build: "dev" });
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
    expect(m.systemctlChanges()).toBe("");
    expect(m.claudeCalls()).toBe("");
    expect(m.questions).toEqual([]);
  });

  test("a full move: folders, records, backups, settings, instructions, gateway, units, uninstall", async () => {
    const m = machine({ build: "dev" });
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
    // The instructions are in place, so the closing line about running `setup` stays out.
    expect(printed.join("\n")).not.toContain("no instructions block");

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

    // S5: the judge's proof does not carry over, and the line says what to run.
    expect(printed.join("\n")).toContain("The judge test does not carry over");
    expect(printed.join("\n")).toContain(
      "cc-smart-dev-kit gateway slot judge omniroute:glm-5.3-flash",
    );

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
    expect(files.some((file) => file.includes(`/${OLD.name}`))).toBe(false);
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
    const m = machine({ build: "dev" });
    await m.run({ yes: true });
    const settings = readFileSync(m.settingsFile, "utf8");
    const config = readFileSync(m.paths.gatewayConfigFile, "utf8");
    printed.length = 0;
    expect(await m.run({ yes: true })).toBe(0);
    expect(printed).toEqual(["Nothing to move."]);
    expect(readFileSync(m.settingsFile, "utf8")).toBe(settings);
    expect(readFileSync(m.paths.gatewayConfigFile, "utf8")).toBe(config);
  });

  test("a gateway config others can read: one error line, exit 1, and nothing moved", async () => {
    const m = machine({ build: "dev" });
    chmodSync(join(m.old.configDir, "gateway.json"), 0o644);
    expect(await m.run({})).toBe(1);
    expect(printed.join("\n")).toContain("can be read by other users");
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
  });

  test("a target that already exists: stops before anything, and never merges", async () => {
    const m = machine({ build: "dev" });
    mkdirSync(join(m.home, ".config", "cc-smart-dev-kit"), { recursive: true });
    expect(await m.run({})).toBe(1);
    expect(printed.join("\n")).toContain("is already there");
    expect(printed.join("\n")).toContain("never merged");
    expect(existsSync(m.old.configDir)).toBe(true);
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(m.questions).toEqual([]);
  });

  test("inside a Claude Code session: refused, and nothing moved", async () => {
    const m = machine({ build: "dev" });
    expect(await m.run({ env: { CLAUDECODE: "1" } })).toBe(1);
    expect(printed.join("\n")).toContain("cannot run inside a Claude Code session");
    expect(existsSync(m.old.launcher)).toBe(true);
    expect(existsSync(m.new.stateDir)).toBe(false);
  });

  test("an old Bun: refused before anything is read", async () => {
    const m = machine({ build: "dev" });
    expect(await m.run({ bunVersion: "1.4.2" })).toBe(1);
    expect(printed.join("\n")).toContain("needs Bun ≥ 1.4.3");
    expect(existsSync(m.old.launcher)).toBe(true);
  });

  test("the new plugin is not installed: the install commands, and nothing moved", async () => {
    const m = machine({ build: "dev" });
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
    const m = machine({ build: "dev" });
    await m.run({ yes: true });
    expect(await m.restore({ now: true })).toBe(0);
    const settings = readJson(m.settingsFile);
    // Its keys are gone, and the `env` object setup made with them went too (the settings
    // file here had none); the file, and everything else in it, stays.
    expect(settings.env).toBeUndefined();
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
    const m = machine({ build: "dev" });
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

  test("the new state folder's bookkeeping names are the ones migration may go into", () => {
    // One list, kept true: every name the plugin's own hooks and background update write.
    expect(BOOKKEEPING_NAMES).toContain("sessions");
    expect(BOOKKEEPING_NAMES).toContain("update-check.json");
    expect(BOOKKEEPING_NAMES).toContain("update.log");
    expect(BOOKKEEPING_NAMES).toContain("notify.json");
    // The held major version (D33): a background check writes it with no command run.
    expect(BOOKKEEPING_NAMES).toContain("update-major.json");
    expect(BOOKKEEPING_NAMES).toContain("update-hold");
    expect(BOOKKEEPING_NAMES).toContain("update-reported");
    expect(BOOKKEEPING_NAMES).toContain("update");
    expect(BOOKKEEPING_NAMES).not.toContain("owned.json");
    expect(BOOKKEEPING_NAMES).not.toContain("changed.json");
    expect(BOOKKEEPING_NAMES).not.toContain("instructions");
  });

  test("the progress record lives in the new state folder, and is gone after a finished run", async () => {
    const m = machine({ build: "dev" });
    expect(await m.run({ yes: true })).toBe(0);
    expect(existsSync(progressFile(m.new.stateDir))).toBe(false);
  });
});

/** The systemd user folder the fixture's units live in, for a test's own unit files. */
function systemdDir(home: string): string {
  return join(home, ".config", "systemd", "user");
}

/** The state folder's `changed.json`, as the moved machine has it. */
function changedFilesOf(m: ReturnType<typeof machine>): Record<string, unknown> {
  return readJson(join(m.new.stateDir, "changed.json")).files;
}

/**
 * The gateway config the migration reads before anything moves: `readOldConfig` keeps
 * `loadConfigFile`'s "a file others can read is refused" rule, and `isOwnerOnly` is what decides
 * it. On Windows the mode says nothing (a writable file reports 0o100666 there whatever its ACL
 * says), so a refusal over those bits would stop every Windows run over a config the profile's
 * ACL already protects.
 *
 * This file's end-to-end runs need a fake `systemctl` (a shell script), so they stay in the Linux
 * job; the reader's own rule is checked here, where both platforms can be asked for.
 */
describe("readOldConfig — the mode rule", () => {
  const config = { backends: { omniroute: { apiKey: "omni-key-123456" } }, slots: {}, version: 1 };

  function configFile(): string {
    const file = join(tempDir("migrate-old-config"), "gateway.json");
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return file;
  }

  test("a file the group or others can read is refused off Windows", () => {
    const file = configFile();
    chmodSync(file, 0o644);
    expect(() => readOldConfig(file, "linux")).toThrow("can be read by other users (mode 644)");
    expect(() => readOldConfig(file, "darwin")).toThrow("Run: chmod 600");
  });

  test("on Windows the same file is read: the mode there says nothing", () => {
    const file = configFile();
    chmodSync(file, 0o666);
    expect(readOldConfig(file, "win32")).toEqual(config);
  });

  test("its own file: read on both", () => {
    const file = configFile();
    expect(readOldConfig(file, "linux")).toEqual(config);
    expect(readOldConfig(file, "win32")).toEqual(config);
  });
});
