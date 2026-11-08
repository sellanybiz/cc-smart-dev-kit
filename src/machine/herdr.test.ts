import { expect, test } from "bun:test";
import { world } from "../testing/fake-machine";
import { herdrPlan } from "./herdr";

test("offers latest GUI on a Linux desktop, not a TUI", () => {
  const w = world();
  expect(herdrPlan(w.paths, w.machine, { DISPLAY: ":1" }).kind).toBe("install");
});

test("supports upstream targets, refuses root and missing desktop/interpreter facts", () => {
  const w = world();
  for (const [platform, arch, env] of [
    ["linux", "arm64", { WAYLAND_DISPLAY: "wayland-0" }],
    ["darwin", "arm64", {}],
    ["win32", "x64", { LOCALAPPDATA: "/local" }],
  ] as const) {
    w.machine.platform = platform;
    w.machine.arch = arch;
    expect(herdrPlan(w.paths, w.machine, env).kind).toBe("install");
  }
  expect(herdrPlan(w.paths, w.machine, {}).kind).toBe("skip");
  w.machine.userId = 0;
  expect(herdrPlan(w.paths, w.machine, { LOCALAPPDATA: "/local" }).kind).toBe("skip");
  w.machine.userId = 1000;
  w.machine.which = () => null;
  expect(herdrPlan(w.paths, w.machine, { LOCALAPPDATA: "/local" }).kind).toBe("skip");
});

test("Rosetta on Apple Silicon is supported, while true Intel stays unsupported", () => {
  const w = world({ platform: "darwin", arch: "x64" });
  w.machine.nativeAppleSilicon = true;
  expect(herdrPlan(w.paths, w.machine, {}).kind).toBe("install");
  w.machine.nativeAppleSilicon = false;
  expect(herdrPlan(w.paths, w.machine, {}).kind).toBe("skip");
});

test("preserves a GUI on PATH before platform eligibility", () => {
  const w = world({ platform: "freebsd" });
  w.machine.which = (name) => (name === "herdr-app" ? "/custom/herdr-app" : null);
  expect(herdrPlan(w.paths, w.machine, {}).kind).toBe("existing");
});

test("headless and unsupported platforms explain a manual skip", () => {
  const w = world();
  expect(herdrPlan(w.paths, w.machine, {}).kind).toBe("skip");
  for (const [platform, arch] of [
    ["darwin", "x64"],
    ["win32", "arm64"],
    ["linux", "ia32"],
    ["freebsd", "x64"],
  ] as const) {
    w.machine.platform = platform;
    w.machine.arch = arch;
    expect(herdrPlan(w.paths, w.machine, { DISPLAY: ":1" }).kind).toBe("skip");
  }
});

test("preserves upstream platform destinations and XDG installs", () => {
  const w = world();
  for (const [platform, path, env] of [
    ["linux", "/data/herdr-app", { XDG_DATA_HOME: "/data" }],
    ["darwin", "/Applications/Herdr.app", {}],
    ["darwin", `${w.home}/Applications/Herdr.app`, {}],
    ["win32", "/local/Programs/herdr-app", { LOCALAPPDATA: "/local" }],
  ] as const) {
    w.machine.platform = platform;
    w.machine.exists = (candidate) => candidate === path;
    expect(herdrPlan(w.paths, w.machine, env).kind).toBe("existing");
  }
});
