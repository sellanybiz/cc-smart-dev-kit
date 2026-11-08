import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import type { Machine } from "./machine";

export const NO_HERDR_FLAG = "--no-herdr";
export const HERDR_DOWNLOAD_URL = "https://herdr.dev/download/";
const HERDR_RELEASES = "https://releases.herdr.dev";
/** Clear all installer-owned controls, including controls added upstream later. */
export const HERDR_ENV_PREFIXES = ["HERDR_", "HC_"] as const;

export type HerdrPlan =
  | { kind: "existing" | "skip"; note: string }
  | {
      kind: "install";
      url: string;
      interpreter: string;
      app: string;
      core: string;
      disclosure: string;
    };

/** Upstream owns these destinations; they never enter the kit's restore records. */
export function herdrPlan(
  paths: CliPaths,
  machine: Machine,
  env: Record<string, string | undefined>,
): HerdrPlan {
  const windows = machine.platform === "win32";
  const local = env.LOCALAPPDATA;
  const data = env.XDG_DATA_HOME || join(paths.home, ".local", "share");
  const app = windows
    ? join(local || join(paths.home, "AppData", "Local"), "Programs", "herdr-app")
    : machine.platform === "darwin"
      ? join(paths.home, "Applications", "Herdr.app")
      : join(data, "herdr-app");
  const core = windows
    ? join(
        local || join(paths.home, "AppData", "Local"),
        "Programs",
        "herdr-core",
        "herdr-core.exe",
      )
    : join(paths.binDir, "herdr-core");
  const existing = [app, join(paths.binDir, windows ? "herdr-app.exe" : "herdr-app")];
  if (machine.platform === "darwin") existing.push("/Applications/Herdr.app");
  if (machine.which("herdr-app") !== null || existing.some(machine.exists)) {
    return {
      kind: "existing",
      note: "Herdr GUI already exists; left alone (no update or configuration).",
    };
  }
  const skip = (reason: string): HerdrPlan => ({
    kind: "skip",
    note: `Herdr GUI skipped: ${reason}. See ${HERDR_DOWNLOAD_URL}`,
  });
  if (machine.userId === 0) return skip("use a normal user account, not root");
  if (
    !(machine.platform === "linux" && ["x64", "arm64"].includes(machine.arch)) &&
    !(
      machine.platform === "darwin" &&
      (machine.arch === "arm64" || (machine.arch === "x64" && machine.nativeAppleSilicon === true))
    ) &&
    !(windows && machine.arch === "x64")
  )
    return skip(`no supported GUI build for ${machine.platform}/${machine.arch}`);
  if (machine.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY)
    return skip("no desktop display (DISPLAY or WAYLAND_DISPLAY)");
  if (windows && !local) return skip("LOCALAPPDATA is missing");
  const interpreter = machine.which(windows ? "powershell.exe" : "sh");
  if (interpreter === null) return skip(windows ? "PowerShell is missing" : "sh is missing");
  const url = `${HERDR_RELEASES}/app/install.${windows ? "ps1" : "sh"}`;
  const bootstrap = `${HERDR_RELEASES}/core/install.${windows ? "ps1" : "sh"}`;
  return {
    kind: "install",
    url,
    interpreter,
    app,
    core,
    disclosure: `Herdr GUI: download and run ${url} for the latest app at ${app}; its normal missing-core bootstrap uses ${bootstrap} (core at ${core}, or existing core on PATH). Upstream manages the app, core, shortcuts${windows ? " and Windows user PATH" : " and launcher"}; kit restore does not uninstall them. The app updates itself. Upstream telemetry defaults stay unchanged; setup does not configure preferences or launch Herdr. Upstream checks artifact hashes against release manifests, not installer script hashes.`,
  };
}

/** Presence only: never start a core just to check installation. */
export function herdrCorePresent(machine: Machine, core: string): boolean {
  return machine.exists(core) || machine.which("herdr-core") !== null;
}
