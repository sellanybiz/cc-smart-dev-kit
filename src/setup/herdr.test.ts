import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { herdrPlan } from "../machine/herdr";
import { world } from "../testing/fake-machine";
import { installHerdr } from "./herdr";

test("stages official script under the lock, sanitizes child env, cleans up and never launches", async () => {
  const w = world();
  const plan = herdrPlan(w.paths, w.machine, { DISPLAY: ":1" });
  if (plan.kind !== "install") throw new Error("expected install");
  const calls: unknown[] = [];
  w.machine.fetchText = async (url) => {
    expect(existsSync(join(w.paths.stateDir, "lock"))).toBe(true);
    expect(url).toBe("https://releases.herdr.dev/app/install.sh");
    return "fake script data";
  };
  w.machine.run = (argv, options) => {
    calls.push(options);
    expect(argv[0]).toBe(plan.interpreter);
    expect(argv[1]).toStartWith(w.paths.stateDir);
    const script = argv[1];
    if (script === undefined) throw new Error("missing staged script");
    expect(existsSync(script)).toBe(true);
    w.machine.exists = (path) => path === plan.app || path === plan.core;
    return { exitCode: 0, output: "installed" };
  };
  expect((await installHerdr(w.paths, w.machine, { DISPLAY: ":1" })).ok).toBe(true);
  expect(calls).toEqual([{ unsetEnvPrefixes: ["HERDR_", "HC_"] }]);
  expect(
    readdirSync(w.paths.stateDir).filter((name) => name.startsWith("herdr-") || name === "lock"),
  ).toEqual([]);
  expect(w.detached).toEqual([]);
  expect((await installHerdr(w.paths, w.machine, {})).lines.join(" ")).toContain("already exists");
  expect(calls).toHaveLength(1);
});

test("app exit zero with missing core is incomplete; failed fetch and installer are reported", async () => {
  const w = world();
  w.machine.fetchText = async () => "data";
  w.machine.run = () => ({ exitCode: 0, output: "Herdr is installed" });
  w.machine.exists = (path) => path.endsWith("herdr-app");
  // Preserve only after installation, not during the initial planning pass.
  let installed = false;
  w.machine.exists = (path) => installed && path.endsWith("herdr-app");
  w.machine.run = () => {
    installed = true;
    return { exitCode: 0, output: "Herdr is installed" };
  };
  const incomplete = await installHerdr(w.paths, w.machine, { DISPLAY: ":1" });
  expect(incomplete.ok).toBe(false);
  expect(incomplete.lines.join(" ")).toContain("GUI installed; herdr-core is unavailable");
  installed = false;
  w.machine.run = () => ({ exitCode: 1, output: "failure" });
  expect((await installHerdr(w.paths, w.machine, { DISPLAY: ":1" })).ok).toBe(false);
  w.machine.fetchText = async () => {
    throw new Error("offline");
  };
  expect((await installHerdr(w.paths, w.machine, { DISPLAY: ":1" })).lines.join(" ")).toContain(
    "offline",
  );
  expect(
    readdirSync(w.paths.stateDir).filter((name) => name.startsWith("herdr-") || name === "lock"),
  ).toEqual([]);
});

test("Windows uses explicit PowerShell file argv, not an expression", async () => {
  const w = world({ platform: "win32" });
  let calls = 0;
  let recorded: string[] = [];
  w.machine.fetchText = async (url) => {
    expect(url).toBe("https://releases.herdr.dev/app/install.ps1");
    return "data";
  };
  w.machine.run = (argv) => {
    calls++;
    recorded = argv;
    return { exitCode: 1, output: "fake" };
  };
  await installHerdr(w.paths, w.machine, { LOCALAPPDATA: "/local" });
  expect(calls).toBe(1);
  expect(recorded.slice(1, 6)).toEqual([
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
  ]);
  expect(recorded).toHaveLength(7);
});
