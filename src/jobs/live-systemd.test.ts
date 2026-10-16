/**
 * The launch against the REAL systemd user manager of this machine: opt-in, skipped unless
 * `CC_SMART_DEV_KIT_LIVE_SYSTEMD=1`. Everything else in the tests fakes systemd; these check what
 * the fakes assume: where a slice and a scope live under /sys/fs/cgroup, that a scope's
 * kill and its `cgroup.events` work, and that a job over the slice's ceiling is killed
 * and named "killed for memory".
 *
 * They start throwaway units in a throwaway slice (`amlive<random>-heavy.slice`), never
 * the real `cc-smart-dev-kit-heavy.slice`, and stop and revert every one of them at the end.
 *
 *   CC_SMART_DEV_KIT_LIVE_SYSTEMD=1 bun test src/jobs/live-systemd.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { DEFAULT_KINDS } from "./kinds";
import { realLaunchFacts, realScope, realSliceControl, spawnAndWait, unitName } from "./launch";
import { realReadText, userSliceCgroup } from "./memory";
import { runJob } from "./run";

const LIVE = process.env.CC_SMART_DEV_KIT_LIVE_SYSTEMD === "1";
const uid = process.getuid?.() ?? -1;
const prefix = `amlive${crypto.randomUUID().slice(0, 6)}`;
const SLICE = `${prefix}-heavy.slice`;
const PARENT = `${prefix}.slice`;

function systemctl(...args: string[]): { code: number; out: string } {
  const result = Bun.spawnSync(["systemctl", "--user", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  return { code: result.exitCode ?? 1, out: result.stdout.toString().trim() };
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(50);
  }
  return check();
}

afterAll(() => {
  if (!LIVE) return;
  // Stop what is left, and drop the ceiling `set-property --runtime` wrote.
  systemctl("stop", SLICE, PARENT);
  systemctl("revert", SLICE, PARENT);
  const left = systemctl("list-units", "--all", "--plain", "--no-legend", `${prefix}*`).out;
  if (left !== "") throw new Error(`live test units left behind: ${left}`);
  const dropIns = `/run/user/${String(uid)}/systemd/user.control/${SLICE}.d`;
  if (existsSync(dropIns)) throw new Error(`live test drop-ins left behind: ${dropIns}`);
});

describe.if(LIVE)("the real systemd user manager (CC_SMART_DEV_KIT_LIVE_SYSTEMD=1)", () => {
  test("a scope lives where userSliceCgroup says; its kill and its cgroup.events work", async () => {
    const unit = unitName(SLICE, "tsc", process.pid, Date.now());
    const job = Bun.spawn(
      [
        "systemd-run",
        "--user",
        "--scope",
        "--quiet",
        "--collect",
        `--slice=${SLICE}`,
        `--unit=${unit}`,
        "--",
        "sleep",
        "30",
      ],
      { stdout: "ignore", stderr: "inherit" },
    );
    const group = () => systemctl("show", "-p", "ControlGroup", "--value", unit).out;
    expect(await until(() => group() !== "", 5_000)).toBe(true);
    expect(group()).toBe(`${userSliceCgroup(uid, SLICE)}/${unit}`);
    expect(systemctl("show", "-p", "ControlGroup", "--value", SLICE).out).toBe(
      userSliceCgroup(uid, SLICE),
    );
    const scope = realScope(SLICE, unit, realReadText);
    if (scope === null) throw new Error("no uid");
    expect(scope.isEmpty()).toBe(false);
    scope.kill("SIGTERM");
    expect(await job.exited).toBe(143);
    expect(await until(() => scope.isEmpty(), 5_000)).toBe(true);
  });

  test("a job over the slice's tiny ceiling is killed, and named killed for memory", async () => {
    const said: string[] = [];
    // About 16 MB more each round, touched so it is really used: past 128 MB at once.
    const hog: [string, ...string[]] = [
      process.execPath,
      "-e",
      "const a = []; for (;;) a.push(Buffer.alloc(16 * 1024 * 1024, 1));",
    ];
    const spec = DEFAULT_KINDS.tsc;
    if (spec === undefined) throw new Error("no tsc kind");
    const code = await runJob(
      {
        kind: "tsc",
        spec,
        command: hog,
        gb: 1,
        pid: process.pid,
        checkout: process.cwd(),
        slice: SLICE,
        startedAt: Date.now(),
      },
      {
        isNested: () => Promise.resolve(false),
        ancestorHoldsName: () => Promise.resolve(false),
        acquire: (job) => Promise.resolve({ gb: job.gb, release: () => undefined }),
        workersFor: () => 1,
        memoryMaxFor: () => "128M",
        launchFacts: () => realLaunchFacts(SLICE),
        slice: realSliceControl(realReadText),
        run: (argv, scopeUnit) =>
          spawnAndWait(argv, new EventEmitter(), (line) => said.push(line), {
            scope: scopeUnit === null ? null : realScope(SLICE, scopeUnit, realReadText),
          }),
        say: (line) => said.push(line),
      },
    );
    console.log(`live: exit ${String(code)}; said: ${JSON.stringify(said)}`);
    expect(code).not.toBe(0);
    expect(said).toContain(
      `killed for memory: the heavy jobs running here together went over ${SLICE}'s ceiling, and the kernel stopped the largest. Run it again when fewer heavy jobs run (exit code ${String(code)}).`,
    );
  }, 60_000);
});
