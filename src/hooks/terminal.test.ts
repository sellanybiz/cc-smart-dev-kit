/**
 * The session's own terminal device (`terminal.ts`): which device a hook may write to, and
 * that it never writes to one that is not this user's. The `/proc` tree and the device are
 * fakes in a temp folder, so nothing here touches a real session.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  claudePid,
  realTerminalProbe,
  sessionTerminalDevice,
  type TerminalProbe,
  ttyDevice,
  writeDevice,
} from "./terminal";

/** A fake `/proc` tree: `<home>/proc/<pid>/fd/<n>` symlinked to `device`. */
function fakeProc(links: Record<string, string>, pid = 4242): { procRoot: string; pid: number } {
  const procRoot = join(tempDir("terminal"), "proc");
  for (const [fd, target] of Object.entries(links)) {
    const dir = join(procRoot, String(pid), "fd");
    mkdirSync(dir, { recursive: true });
    symlinkSync(target, join(dir, fd));
  }
  return { procRoot, pid };
}

/** A probe over the fake tree, with the answers a test wants for ownership. */
function probe(overrides: Partial<TerminalProbe> = {}): TerminalProbe {
  return {
    owner: () => 1000,
    pid: 4242,
    platform: "linux",
    procRoot: "/nowhere",
    // The fake tree is a real one in a temp folder: the reader is the real `readlink`.
    readlink: (path) => {
      try {
        return readlinkSync(path);
      } catch {
        return null;
      }
    },
    uid: 1000,
    ...overrides,
  };
}

describe("ttyDevice", () => {
  it("a controlling terminal everywhere that has one; Windows has no such device", () => {
    expect(ttyDevice("linux")).toBe("/dev/tty");
    expect(ttyDevice("darwin")).toBe("/dev/tty");
    expect(ttyDevice("win32")).toBe(null);
  });
});

describe("claudePid", () => {
  it("CLAUDE_PID when it is usable, else the hook's parent, else nothing", () => {
    expect(claudePid({ CLAUDE_PID: "4242" }, 99)).toBe(4242);
    expect(claudePid({ CLAUDE_PID: "not a pid" }, 99)).toBe(99);
    expect(claudePid({ CLAUDE_PID: "0" }, 99)).toBe(99);
    expect(claudePid({}, 99)).toBe(99);
    expect(claudePid({}, 0)).toBe(0);
  });
});

describe("sessionTerminalDevice", () => {
  it("the session's pty, from fd 0 first, and a /dev/ttyN this user owns", () => {
    const { pid, procRoot } = fakeProc({ 0: "/dev/pts/7", 1: "/dev/pts/8" });
    expect(sessionTerminalDevice(probe({ pid, procRoot }))).toBe("/dev/pts/7");
    const second = fakeProc({ 0: "/dev/null", 1: "/dev/pts/8" });
    expect(sessionTerminalDevice(probe({ pid: second.pid, procRoot: second.procRoot }))).toBe(
      "/dev/pts/8",
    );
    const console = fakeProc({ 2: "/dev/tty2" });
    expect(sessionTerminalDevice(probe({ pid: console.pid, procRoot: console.procRoot }))).toBe(
      "/dev/tty2",
    );
  });

  it("never a device that is not this user's, and never anything but a terminal", () => {
    // Another person's pty: their fd 0 is a device this user does not own.
    const other = fakeProc({ 0: "/dev/pts/7" });
    expect(
      sessionTerminalDevice(probe({ owner: () => 1001, pid: other.pid, procRoot: other.procRoot })),
    ).toBeNull();
    // A regular file, a pipe, a network device, a device whose owner cannot be read.
    for (const target of ["/tmp/a-file", "pipe:[123]", "/dev/null", "/dev/pts/abc"]) {
      const fake = fakeProc({ 0: target });
      expect(sessionTerminalDevice(probe({ pid: fake.pid, procRoot: fake.procRoot }))).toBeNull();
    }
    const unreadable = fakeProc({ 0: "/dev/pts/7" });
    expect(
      sessionTerminalDevice(
        probe({ owner: () => null, pid: unreadable.pid, procRoot: unreadable.procRoot }),
      ),
    ).toBeNull();
  });

  it("no fd, another platform, or no pid at all: nothing", () => {
    expect(sessionTerminalDevice(probe())).toBeNull();
    const { pid, procRoot } = fakeProc({ 0: "/dev/pts/7" });
    expect(sessionTerminalDevice(probe({ pid, platform: "darwin", procRoot }))).toBeNull();
    expect(sessionTerminalDevice(probe({ pid: 0, procRoot }))).toBeNull();
  });

  it("the real probe reads /proc and this user's uid; another platform gives no device", () => {
    const real = realTerminalProbe({ CLAUDE_PID: String(process.pid) }, 0);
    expect(real.pid).toBe(process.pid);
    expect(real.procRoot).toBe("/proc");
    expect(real.uid).toBe(typeof process.getuid === "function" ? process.getuid() : -1);
    // This test's own fd 0 is not a terminal, and its parent's is not this user's device:
    // whatever it finds, it is never a device the machine did not hand this user.
    const own = sessionTerminalDevice(real);
    if (own !== null) expect(own).toMatch(/^\/dev\/(pts\/\d+|tty\d+)$/);
  });
});

describe("writeDevice", () => {
  it("writes the bytes to the device, and says false when it cannot be opened", () => {
    const file = join(tempDir("terminal"), "device");
    writeFileSync(file, "");
    expect(writeDevice(file, "\u001b]777;notify;a;b\u0007")).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("\u001b]777;notify;a;b\u0007");
    expect(writeDevice(join(tempDir("terminal"), "missing"), "x")).toBe(false);
  });

  it("the whole route: a fake /proc, a fake device, and the bytes that land in it", () => {
    const device = join(tempDir("terminal"), "pts-7");
    writeFileSync(device, "");
    const { pid, procRoot } = fakeProc({ 0: device });
    // The fake device is not under /dev, so the test widens only the name rule; ownership
    // stays the real one, and the real rule is tested above.
    const found = sessionTerminalDevice(
      probe({
        isTerminalDevice: (path) => path === device,
        owner: () => 1000,
        pid,
        procRoot,
        uid: 1000,
      }),
    );
    expect(found).toBe(device);
    expect(found === null ? false : writeDevice(found, "alert")).toBe(true);
    expect(readFileSync(device, "utf8")).toBe("alert");
  });
});
