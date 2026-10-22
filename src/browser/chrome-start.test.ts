/**
 * The person's Chrome, started when the first browser call finds none running (`chrome-start.ts`):
 * the environment a started Chrome needs to open a window on the person's desktop, its exact
 * argv, and the one plain line that ends a call when Chrome cannot start.
 *
 * The Chrome here is a world of its own: `exists`, `readlink` and the spawn are fakes, so no test
 * reads or starts the machine's real Chrome.
 */
import { describe, expect, test } from "bun:test";
import {
  CHROME_START_LIMIT_MS,
  type ChromeStartDeps,
  chromeLaunchArgv,
  desktopEnvironment,
  ensureChromeRunning,
  type StartedChrome,
} from "./chrome-start";

/** The user manager's own answer to `systemctl --user show-environment`. */
const managerEnv = (...lines: string[]) => ({
  run: () => ({ exitCode: 0, output: lines.join("\n") }),
});

describe("desktopEnvironment", () => {
  test("a session with a display keeps its own variables, and asks no one", () => {
    const read = desktopEnvironment(
      { DISPLAY: ":0", XDG_RUNTIME_DIR: "/run/user/1", HOME: "/home/someone" },
      {
        platform: "linux",
        run: () => {
          throw new Error("the user manager is not asked when the session has a display");
        },
      },
    );
    expect(read).toEqual({
      display: true,
      source: "session",
      vars: { DISPLAY: ":0", XDG_RUNTIME_DIR: "/run/user/1" },
    });
  });

  test("a background session with none takes the user manager's", () => {
    // A session started by the daemon has XDG_SESSION_TYPE=tty and no DISPLAY (measured
    // 2026-10-23); the graphical session imported its own into the systemd user manager.
    const read = desktopEnvironment(
      { DISPLAY: "", XDG_SESSION_TYPE: "tty" },
      {
        platform: "linux",
        ...managerEnv(
          "DISPLAY=:10.0",
          "WAYLAND_DISPLAY=",
          "XDG_RUNTIME_DIR=/run/user/1001",
          "PWD=/",
        ),
      },
    );
    expect(read).toEqual({
      display: true,
      source: "user-manager",
      vars: { DISPLAY: ":10.0", XDG_RUNTIME_DIR: "/run/user/1001" },
    });
  });

  test("nothing anywhere: no display, and nothing is invented", () => {
    const read = desktopEnvironment(
      { XDG_SESSION_TYPE: "tty" },
      { platform: "linux", run: () => ({ exitCode: 1, output: "Failed to connect to bus" }) },
    );
    expect(read).toEqual({ display: false, source: "none", vars: {} });
  });

  test("macOS and Windows need no DISPLAY: a window opens without one", () => {
    for (const platform of ["darwin", "win32"] as const) {
      const read = desktopEnvironment(
        {},
        {
          platform,
          run: () => {
            throw new Error("systemctl is Linux's own");
          },
        },
      );
      expect(read.display).toBe(true);
      expect(read.source).toBe("session");
    }
  });
});

describe("chromeLaunchArgv", () => {
  test("the found Chrome, the profile's folder name, and no first-run bubble", () => {
    expect(chromeLaunchArgv("/opt/google/chrome/chrome", "Profile 2")).toEqual([
      "/opt/google/chrome/chrome",
      "--profile-directory=Profile 2",
      "--no-first-run",
      "--no-default-browser-check",
    ]);
  });
});

/** A Chrome world: the executable, a `SingletonLock`, and the spawn this test records. */
function world(options: { lock?: () => null | string; alive?: boolean } = {}) {
  const lock = options.lock ?? (() => null);
  const starts: { argv: string[]; env: Record<string, string> }[] = [];
  const kills: string[] = [];
  let exit: (code: number) => void = () => undefined;
  let stderr = "";
  const deps: ChromeStartDeps = {
    chrome: {
      home: "/home/user",
      platform: "linux",
      isAlive: () => options.alive ?? true,
      readlink: lock,
      hostname: () => "host",
    },
    desktop: () => ({ display: true, source: "session", vars: { DISPLAY: ":0" } }),
    startChrome: (argv, env): StartedChrome => {
      starts.push({ argv, env });
      return {
        exited: new Promise<number>((done) => {
          exit = done;
        }),
        kill: (signal) => kills.push(signal),
        stderr: () => stderr,
      };
    },
    // The real wait is 15 s; a test's is short, and the poll it uses is short too.
    limitMs: CHROME_START_LIMIT_MS,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  };
  return {
    deps,
    exit: (code: number, text = "") => {
      stderr = text;
      exit(code);
    },
    kills,
    starts,
  };
}

const ready = {
  chrome: "/opt/google/chrome/chrome",
  profileDirName: "claude-code",
  userDataDir: "/home/user/.config/google-chrome",
};

describe("ensureChromeRunning", () => {
  test("a Chrome is running: nothing is started", async () => {
    const testWorld = world({ lock: () => "host-4242" });
    const result = await ensureChromeRunning(ready, testWorld.deps);
    expect(result).toEqual({ ok: true, started: false });
    expect(testWorld.starts).toEqual([]);
  });

  test("no Chrome: it starts the found one with the profile, on the person's desktop", async () => {
    let running = false;
    const testWorld = world({
      lock: () => (running ? "host-4242" : null),
    });
    const started = testWorld.starts;
    const start = testWorld.deps.startChrome;
    testWorld.deps.startChrome = (argv, env) => {
      running = true; // Chrome takes the singleton lock as it starts
      return start(argv, env);
    };
    const result = await ensureChromeRunning(ready, testWorld.deps);
    expect(result).toEqual({ ok: true, started: true });
    expect(started).toEqual([
      {
        argv: [
          "/opt/google/chrome/chrome",
          "--profile-directory=claude-code",
          "--no-first-run",
          "--no-default-browser-check",
        ],
        env: { DISPLAY: ":0" },
      },
    ]);
  });

  test("a lock from before the restart (a dead pid) is not a running Chrome", async () => {
    // The machine restarted; Chrome's own `SingletonLock` still names the pid it had.
    const testWorld = world({ lock: () => "host-999999", alive: false });
    let running = false;
    const start = testWorld.deps.startChrome;
    testWorld.deps.startChrome = (argv, env) => {
      running = true;
      return start(argv, env);
    };
    testWorld.deps.chrome.isAlive = () => running || false;
    const result = await ensureChromeRunning(ready, testWorld.deps);
    expect(result).toEqual({ ok: true, started: true });
    expect(testWorld.starts).toHaveLength(1);
  });

  test("a Chrome that exits at once: its own words, and the one step to take", async () => {
    const testWorld = world();
    testWorld.deps.limitMs = 1_000;
    const promise = ensureChromeRunning(ready, testWorld.deps);
    await Bun.sleep(5);
    testWorld.exit(1, "Missing X server or $DISPLAY");
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toContain("exited at once (code 1: Missing X server or $DISPLAY)");
      expect(result.why).toContain('"claude-code"');
      expect(result.why).toContain("Open Google Chrome");
    }
  });

  test("a Chrome that never comes up: its own line, no wait past the limit, and it is stopped", async () => {
    const testWorld = world();
    testWorld.deps.limitMs = 40;
    testWorld.deps.sleep = () => new Promise((done) => setTimeout(done, 5));
    const result = await ensureChromeRunning(ready, testWorld.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toContain("did not come up");
      expect(result.why).toContain("Open Google Chrome");
    }
    expect(testWorld.kills).toEqual(["SIGTERM"]);
  });

  test("no display at all: nothing is started, and the line says the one step", async () => {
    const testWorld = world();
    testWorld.deps.desktop = () => ({ display: false, source: "none", vars: {} });
    const result = await ensureChromeRunning(ready, testWorld.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toContain("no desktop display");
      expect(result.why).toContain("Open Google Chrome");
    }
    expect(testWorld.starts).toEqual([]);
  });

  test("a spawn that throws is one plain line, never a thrown error", async () => {
    const testWorld = world();
    testWorld.deps.startChrome = () => {
      throw new Error("EACCES: permission denied");
    };
    const result = await ensureChromeRunning(ready, testWorld.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toContain("could not be started (EACCES: permission denied)");
      expect(result.why).toContain("Open Google Chrome");
    }
  });
});
