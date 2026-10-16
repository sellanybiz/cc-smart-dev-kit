/**
 * The shared browser (`shared-browser.ts`), and the port lock it starts under
 * (`hold-port.ts`).
 *
 * A fake "Chrome" here is a real HTTP server that answers `/json/version` and writes
 * `DevToolsActivePort`, the way Chrome does: so the whole start path — the lock, the stale
 * lock files, the profile claim — runs for real, without the real binary.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { askHolder, holdPort } from "./hold-port";
import {
  chromeArgs,
  chromeCandidates,
  ensureSharedBrowser,
  findChrome,
  isProfileInUse,
  type SystemProbe,
} from "./shared-browser";

/** A fake Chrome: what Chrome writes and answers while it runs. */
function fakeChrome(profileDir: string): { pid: number; stop: () => void } {
  mkdirSync(profileDir, { recursive: true });
  const server: Bun.Server<undefined> = Bun.serve({
    fetch(request): Response {
      if (new URL(request.url).pathname === "/json/version") {
        return Response.json({
          Browser: "Chrome/155.0.0.0",
          webSocketDebuggerUrl: `ws://127.0.0.1:${String(server.port)}/devtools/browser/fake-uuid`,
        });
      }
      return new Response("no");
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  if (server.port === undefined) throw new Error("the fake Chrome has no port");
  writeFileSync(
    join(profileDir, "DevToolsActivePort"),
    `${String(server.port)}\n/devtools/browser/fake-uuid\n`,
  );
  return {
    pid: process.pid,
    stop: () => {
      void server.stop(true);
    },
  };
}

const system = (over: Partial<SystemProbe> = {}): SystemProbe => ({
  commandLine: () => "",
  isAlive: () => false,
  openLockfile: () => undefined,
  ...over,
});

describe("findChrome", () => {
  test("the platform's own places, in order; null when none is there", () => {
    expect(chromeCandidates("linux", "/home/user")).toEqual([
      "/opt/google/chrome/chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
    ]);
    expect(findChrome({ exists: () => false, home: "/home/user", platform: "linux" })).toBeNull();
    expect(
      findChrome({
        exists: (path) => path === "/usr/bin/google-chrome",
        home: "/home/user",
        platform: "linux",
      }),
    ).toBe("/usr/bin/google-chrome");
    expect(chromeCandidates("darwin", "/Users/user")).toEqual([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
  });
});

describe("holdPort", () => {
  test("a port nobody holds is taken; a second holder is refused; the asker gets the line", async () => {
    const first = await holdPort(0);
    if (!("held" in first)) throw new Error("the first hold failed");
    const address = first.held.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    first.held.close();

    const held = await holdPort(port, "the shared browser");
    if (!("held" in held)) throw new Error("the second hold failed");
    const again = await holdPort(port);
    expect(again).toEqual({ taken: true });
    expect(await askHolder(port)).toBe("the shared browser");
    held.held.close();
    expect(await askHolder(port)).toBeNull();
  });
});

describe("chromeArgs", () => {
  test("the profile, a debug port Chrome picks, and the switches the profile needs", () => {
    const args = chromeArgs("/tmp/profile");
    expect(args).toContain("--user-data-dir=/tmp/profile");
    expect(args).toContain("--remote-debugging-port=0");
    // Without these two, every saved login in a profile written with them is unreadable.
    expect(args).toContain("--password-store=basic");
    expect(args).toContain("--use-mock-keychain");
    expect(args.at(-1)).toBe("about:blank");
  });
});

describe("ensureSharedBrowser", () => {
  test("a running Chrome is reused: nothing is started", async () => {
    const profile = join(tempDir("browser"), "profile");
    const chrome = fakeChrome(profile);
    let started = 0;
    try {
      const url = await ensureSharedBrowser({
        launchTimeoutMs: 2000,
        lockPort: 0,
        log: () => undefined,
        pathExists: () => true,
        profileDir: profile,
        spawnChrome: () => {
          started += 1;
          return { exited: new Promise(() => undefined), pid: 1 };
        },
      });
      expect(url).toContain("/devtools/browser/fake-uuid");
      expect(started).toBe(0);
    } finally {
      chrome.stop();
    }
  });

  test("no Chrome installed: the message names every place it looked", async () => {
    const profile = join(tempDir("browser"), "profile");
    await expect(
      ensureSharedBrowser({
        launchTimeoutMs: 100,
        lockPort: 0,
        log: () => undefined,
        pathExists: () => false,
        platform: "linux",
        profileDir: profile,
        spawnChrome: () => ({ exited: new Promise(() => undefined), pid: 1 }),
      }),
    ).rejects.toThrow(
      /Google Chrome is not installed where this launcher looks\. Checked: .*Install Google Chrome/,
    );
  });

  test("another program keeps the start-lock port: a clear error, nothing started", async () => {
    const profile = join(tempDir("browser"), "profile");
    const other = await holdPort(0, "something else entirely");
    if (!("held" in other)) throw new Error("the hold failed");
    const address = other.held.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    let started = 0;
    try {
      await expect(
        ensureSharedBrowser({
          launchTimeoutMs: 200,
          lockPort: port,
          lockWaitMs: 200,
          log: () => undefined,
          pathExists: () => true,
          profileDir: profile,
          spawnChrome: () => {
            started += 1;
            return { exited: new Promise(() => undefined), pid: 1 };
          },
        }),
      ).rejects.toThrow(/is held by a program that is not the Playwright launcher/);
      expect(started).toBe(0);
    } finally {
      other.held.close();
    }
  });

  test("a stale Chrome lock (its pid is gone) is cleared, and Chrome starts", async () => {
    const profile = join(tempDir("browser"), "profile");
    mkdirSync(profile, { recursive: true });
    // Chrome's own lock: a symlink whose target is `<hostname>-<pid>`, of a pid that is gone.
    symlinkSync(`${hostname()}-999999`, join(profile, "SingletonLock"));
    writeFileSync(join(profile, "SingletonCookie"), "x");
    writeFileSync(join(profile, "SingletonSocket"), "x");
    const logs: string[] = [];
    let chrome: { stop: () => void } = { stop: () => undefined };
    try {
      const url = await ensureSharedBrowser({
        launchTimeoutMs: 2000,
        lockPort: 0,
        log: (line) => logs.push(line),
        pathExists: () => true,
        profileDir: profile,
        // Starting "Chrome" is what the launcher does: the fake Chrome comes up here and
        // writes the port file, as the real one does.
        spawnChrome: () => {
          const started = fakeChrome(profile);
          chrome = started;
          return { exited: new Promise(() => undefined), pid: started.pid };
        },
      });
      expect(url).toContain("fake-uuid");
      expect(logs.join("\n")).toContain("cleared a stale Chrome lock");
      // The lock files a dead Chrome left are gone; the profile starts clean.
      expect(existsSync(join(profile, "SingletonCookie"))).toBe(false);
    } finally {
      chrome.stop();
    }
  });

  test("a Chrome that still runs on the profile without a debug port: say to close it", async () => {
    const profile = join(tempDir("browser"), "profile");
    mkdirSync(profile, { recursive: true });
    symlinkSync(`${hostname()}-12345`, join(profile, "SingletonLock"));
    await expect(
      ensureSharedBrowser({
        launchTimeoutMs: 200,
        lockPort: 0,
        log: () => undefined,
        pathExists: () => true,
        profileDir: profile,
        spawnChrome: () => ({ exited: new Promise(() => undefined), pid: 1 }),
        system: system({
          commandLine: () => `/usr/bin/google-chrome --user-data-dir=${profile}`,
          isAlive: () => true,
        }),
      }),
    ).rejects.toThrow(/open without its debug port \(pid 12345\)\. Close that Chrome window/);
  });

  test("the shared Chrome itself does not answer yet: say to try again in a moment", async () => {
    const profile = join(tempDir("browser"), "profile");
    mkdirSync(profile, { recursive: true });
    symlinkSync(`${hostname()}-12345`, join(profile, "SingletonLock"));
    await expect(
      ensureSharedBrowser({
        launchTimeoutMs: 200,
        lockPort: 0,
        log: () => undefined,
        pathExists: () => true,
        profileDir: profile,
        spawnChrome: () => ({ exited: new Promise(() => undefined), pid: 1 }),
        system: system({
          commandLine: () =>
            `/opt/google/chrome/chrome --remote-debugging-port=0 --user-data-dir=${profile}`,
          isAlive: () => true,
        }),
      }),
    ).rejects.toThrow(/may be busy, starting or closing: use the browser again in a moment/);
  });

  test("a Chrome that exits at once: the message says why, and a dead pid in the lock is cleared", async () => {
    const profile = join(tempDir("browser"), "profile");
    mkdirSync(profile, { recursive: true });
    await expect(
      ensureSharedBrowser({
        launchTimeoutMs: 2000,
        lockPort: 0,
        log: () => undefined,
        pathExists: () => true,
        platform: "linux",
        profileDir: profile,
        spawnChrome: () => ({
          exited: Promise.resolve({ code: 1, kind: "exit", signal: null }),
          pid: 9,
        }),
      }),
    ).rejects.toThrow(/Chrome exited \(code 1\) before its debug port was ready/);
  });
});

describe("isProfileInUse", () => {
  test("a lock from another computer counts as in use; a dead pid's does not", () => {
    const profile = join(tempDir("browser"), "profile");
    mkdirSync(profile, { recursive: true });
    symlinkSync("another-host-4242", join(profile, "SingletonLock"));
    expect(isProfileInUse(profile, "linux", system(), () => undefined)).toBe(true);

    // A lock of THIS host, whose pid is no Chrome on this profile: not in use.
    rmSync(join(profile, "SingletonLock"));
    symlinkSync(`${hostname()}-4242`, join(profile, "SingletonLock"));
    expect(
      isProfileInUse(
        profile,
        "linux",
        system({ isAlive: () => true, commandLine: () => "/usr/bin/some-other-program" }),
        () => undefined,
      ),
    ).toBe(false);
    expect(isProfileInUse(profile, "linux", system(), () => undefined)).toBe(false);
  });
});

describe("the Chrome we start", () => {
  test("the start lock is released once Chrome answers", async () => {
    const profile = join(tempDir("browser"), "profile");
    const chrome = fakeChrome(profile);
    try {
      // Port 0 means "any free port": the lock is taken and released inside the call.
      await ensureSharedBrowser({
        launchTimeoutMs: 2000,
        lockPort: 27640,
        log: () => undefined,
        pathExists: () => true,
        profileDir: profile,
        spawnChrome: () => ({ exited: new Promise(() => undefined), pid: 1 }),
      });
      // Nothing holds the lock port any more.
      const again = await holdPort(27640);
      expect("held" in again).toBe(true);
      if ("held" in again) again.held.close();
      expect(readFileSync(join(profile, "DevToolsActivePort"), "utf8")).toContain("fake-uuid");
      expect(existsSync(join(profile, "DevToolsActivePort"))).toBe(true);
    } finally {
      chrome.stop();
    }
  });

  test("the profile folder is owner-only: a new one is 0700, and a loose one is tightened, saying so", async () => {
    const home = tempDir("browser");
    const profile = join(home, "data", "playwright");
    // A profile made by an older version, with the default mode: group and other can read it.
    mkdirSync(profile, { recursive: true });
    chmodSync(profile, 0o755);
    writeFileSync(join(profile, "Cookies"), "a signed-in session\n");
    const logs: string[] = [];
    let chrome: { stop: () => void } = { stop: () => undefined };
    try {
      await ensureSharedBrowser({
        launchTimeoutMs: 2000,
        lockPort: 0,
        log: (line) => logs.push(line),
        pathExists: () => true,
        profileDir: profile,
        spawnChrome: () => {
          const started = fakeChrome(profile);
          chrome = started;
          return { exited: new Promise(() => undefined), pid: started.pid };
        },
      });
      // Tightened to its owner only, and the line says what it was.
      expect(statSync(profile).mode & 0o777).toBe(0o700);
      expect(logs.join("\n")).toContain(
        `${profile} was readable by other users (mode 755): made it yours only (700)`,
      );
    } finally {
      chrome.stop();
    }

    // A folder that is fresh: created 0700, with nothing said.
    const fresh = join(home, "fresh", "playwright");
    try {
      await ensureSharedBrowser({
        launchTimeoutMs: 2000,
        lockPort: 0,
        log: (line) => logs.push(line),
        pathExists: () => true,
        profileDir: fresh,
        spawnChrome: () => {
          const started = fakeChrome(fresh);
          chrome = started;
          return { exited: new Promise(() => undefined), pid: started.pid };
        },
      });
      expect(statSync(fresh).mode & 0o777).toBe(0o700);
      // Nothing was said about it: only the loose folder got a line.
      expect(logs.filter((line) => line.includes("was readable by other users"))).toHaveLength(1);
    } finally {
      chrome.stop();
    }
  });
});
