/**
 * Reading this machine's memory (`memory.ts`) from fake files: `/proc/meminfo`, and a
 * cgroup ceiling when the process lives in a container or a limited group. A wrong number
 * here makes the budget and the live check wrong on every job.
 */
import { describe, expect, test } from "bun:test";
import { freemem, totalmem } from "node:os";
import {
  cgroupLimit,
  GIB,
  type MemoryFacts,
  machineBudgetGb,
  machineMemory,
  meminfoBytes,
  ownCgroup,
  realMemoryFacts,
  sliceBytes,
  sliceChain,
  userManagerCgroup,
  userManagerControllers,
  userSliceCgroup,
} from "./memory";

const KB = 1024;

function facts(
  files: Record<string, string>,
  platform: NodeJS.Platform = "linux",
  freememBytes = 0,
): MemoryFacts {
  return {
    platform,
    read: (path) => files[path] ?? null,
    totalmem: () => 999 * GIB,
    freemem: () => freememBytes,
  };
}

const meminfo = (totalGb: number, availableGb: number) =>
  `MemTotal:       ${(totalGb * GIB) / KB} kB\nMemFree:        1000 kB\nMemAvailable:   ${(availableGb * GIB) / KB} kB\n`;

describe("meminfoBytes", () => {
  test("reads a field in bytes", () => {
    const text =
      "MemTotal:       56623104 kB\nMemFree:         1000 kB\nMemAvailable:   20971520 kB\n";
    expect(meminfoBytes(text, "MemTotal")).toBe(56_623_104 * 1024);
    expect(meminfoBytes(text, "MemAvailable")).toBe(20 * GIB);
    expect(meminfoBytes(text, "SwapTotal")).toBeNull();
  });
});

describe("ownCgroup", () => {
  test("reads the v2 path, or the v1 memory controller's", () => {
    expect(ownCgroup("0::/user.slice/user-1000.slice/session-1.scope\n")).toEqual({
      version: 2,
      path: "/user.slice/user-1000.slice/session-1.scope",
    });
    expect(ownCgroup("12:cpu,cpuacct:/docker/abc\n11:memory:/docker/abc\n")).toEqual({
      version: 1,
      path: "/docker/abc",
    });
    expect(ownCgroup("")).toBeNull();
  });
});

describe("cgroupLimit", () => {
  test("a container: its group reads `/`, and the ceiling sits at the top of the mount", () => {
    const read = facts({
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/memory.max": `${16 * GIB}\n`,
      "/sys/fs/cgroup/memory.current": `${10 * GIB}\n`,
      "/sys/fs/cgroup/memory.stat": `anon 100\ninactive_file ${3 * GIB}\nactive_file 5\n`,
    }).read;
    expect(cgroupLimit(read)).toEqual({
      limitBytes: 16 * GIB,
      usedBytes: 7 * GIB, // 10 used, less 3 of cache the kernel can drop
      dir: "/sys/fs/cgroup",
    });
  });

  test("takes the tightest ceiling on the way up, and skips `max`", () => {
    const read = facts({
      "/proc/self/cgroup": "0::/a/b/c\n",
      "/sys/fs/cgroup/a/b/c/memory.max": "max\n",
      "/sys/fs/cgroup/a/b/memory.max": `${8 * GIB}\n`,
      "/sys/fs/cgroup/a/b/memory.current": `${2 * GIB}\n`,
      "/sys/fs/cgroup/a/memory.max": `${32 * GIB}\n`,
      "/sys/fs/cgroup/a/memory.current": `${20 * GIB}\n`,
    }).read;
    expect(cgroupLimit(read)).toEqual({
      limitBytes: 8 * GIB,
      usedBytes: 2 * GIB,
      dir: "/sys/fs/cgroup/a/b",
    });
  });

  test("reads cgroup v1, and takes its huge 'no limit' number as no limit", () => {
    const v1 = (limit: string) =>
      facts({
        "/proc/self/cgroup": "11:memory:/docker/abc\n",
        "/sys/fs/cgroup/memory/docker/abc/memory.limit_in_bytes": limit,
        "/sys/fs/cgroup/memory/docker/abc/memory.usage_in_bytes": `${GIB}\n`,
        "/sys/fs/cgroup/memory/docker/abc/memory.stat": "total_inactive_file 0\n",
      }).read;
    expect(cgroupLimit(v1(`${4 * GIB}\n`))?.limitBytes).toBe(4 * GIB);
    expect(cgroupLimit(v1("9223372036854771712\n"))).toBeNull();
  });

  test("counts a group with no usage file as full: the safe side", () => {
    const read = facts({
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/memory.max": `${4 * GIB}\n`,
    }).read;
    expect(cgroupLimit(read)?.usedBytes).toBe(4 * GIB);
  });

  test("is null with no cgroup file, or no ceiling anywhere", () => {
    expect(cgroupLimit(facts({}).read)).toBeNull();
    expect(
      cgroupLimit(
        facts({ "/proc/self/cgroup": "0::/x\n", "/sys/fs/cgroup/x/memory.max": "max\n" }).read,
      ),
    ).toBeNull();
  });
});

describe("machineMemory", () => {
  test("Linux without a ceiling: MemTotal and MemAvailable", () => {
    expect(machineMemory(facts({ "/proc/meminfo": meminfo(64, 40) }))).toEqual({
      totalBytes: 64 * GIB,
      availableBytes: 40 * GIB,
      limit: null,
    });
  });

  test("in a container with a ceiling below the host: the ceiling, and what is left in it", () => {
    const memory = machineMemory(
      facts({
        "/proc/meminfo": meminfo(64, 40),
        "/proc/self/cgroup": "0::/\n",
        "/sys/fs/cgroup/memory.max": `${16 * GIB}\n`,
        "/sys/fs/cgroup/memory.current": `${12 * GIB}\n`,
        "/sys/fs/cgroup/memory.stat": `inactive_file ${2 * GIB}\n`,
      }),
    );
    expect(memory.totalBytes).toBe(16 * GIB);
    expect(memory.availableBytes).toBe(6 * GIB); // 16 less (12 - 2)
    expect(memory.limit?.dir).toBe("/sys/fs/cgroup");
  });

  test("the host's free memory wins when it is smaller than what is left in the group", () => {
    const memory = machineMemory(
      facts({
        "/proc/meminfo": meminfo(64, 3),
        "/proc/self/cgroup": "0::/\n",
        "/sys/fs/cgroup/memory.max": `${16 * GIB}\n`,
        "/sys/fs/cgroup/memory.current": `${GIB}\n`,
      }),
    );
    expect(memory.availableBytes).toBe(3 * GIB);
  });

  // lxcfs already shows the ceiling as MemTotal: a ceiling at or above it changes nothing.
  test("ignores a ceiling no lower than MemTotal", () => {
    const memory = machineMemory(
      facts({
        "/proc/meminfo": meminfo(54, 40),
        "/proc/self/cgroup": "0::/\n",
        "/sys/fs/cgroup/memory.max": `${54 * GIB}\n`,
        "/sys/fs/cgroup/memory.current": `${50 * GIB}\n`,
      }),
    );
    expect(memory).toEqual({ totalBytes: 54 * GIB, availableBytes: 40 * GIB, limit: null });
  });

  test("macOS and others: os.totalmem(), and no free-memory reading", () => {
    expect(machineMemory(facts({ "/proc/meminfo": meminfo(1, 1) }, "darwin", 3 * GIB))).toEqual({
      totalBytes: 999 * GIB,
      availableBytes: null,
      limit: null,
    });
  });

  test("Windows: os.totalmem() and os.freemem(), and no cgroup file is read", () => {
    const asked: string[] = [];
    const windows: MemoryFacts = {
      platform: "win32",
      read: (path) => {
        asked.push(path);
        return null;
      },
      totalmem: () => 32 * GIB,
      freemem: () => 11 * GIB,
    };
    expect(machineMemory(windows)).toEqual({
      totalBytes: 32 * GIB,
      availableBytes: 11 * GIB,
      limit: null,
    });
    expect(asked).toEqual([]);
  });
});

describe("the machine's own readings", () => {
  test("the real facts are os.totalmem() and os.freemem()", () => {
    const real = realMemoryFacts();
    expect(real.platform).toBe(process.platform);
    expect(real.totalmem).toBe(totalmem);
    expect(real.freemem).toBe(freemem);
  });
});

describe("machineBudgetGb", () => {
  test("leaves the reserve for what never queues", () => {
    expect(machineBudgetGb(54 * GIB, 22, 14)).toBe(32);
    expect(machineBudgetGb(64 * GIB, 22, 14)).toBe(42);
    expect(machineBudgetGb(54 * GIB + 0.9 * GIB, 22, 14)).toBe(32);
  });

  // The largest job (a 14 GB build) must still run on a 16 GB machine, alone.
  test("never drops below the largest single job", () => {
    expect(machineBudgetGb(16 * GIB, 22, 14)).toBe(14);
    expect(machineBudgetGb(37 * GIB, 22, 14)).toBe(15);
  });
});

describe("userSliceCgroup and sliceBytes", () => {
  // A dash in a slice name is nesting: the flat path never exists, and the live check
  // would never see the heavy jobs' memory.
  test("nests at every dash, and leaves a dashless slice at the top", () => {
    expect(userSliceCgroup(1000, "cc-smart-dev-kit-heavy.slice")).toBe(
      "/user.slice/user-1000.slice/user@1000.service/cc.slice/cc-smart.slice/cc-smart-dev.slice/cc-smart-dev-kit.slice/cc-smart-dev-kit-heavy.slice",
    );
    expect(userSliceCgroup(7, "solo.slice")).toBe(
      "/user.slice/user-7.slice/user@7.service/solo.slice",
    );
  });

  test("reads the slice's memory.current, or null", () => {
    const path =
      "/sys/fs/cgroup/user.slice/user-7.slice/user@7.service/cc.slice/cc-smart.slice/cc-smart-dev.slice/cc-smart-dev-kit.slice/cc-smart-dev-kit-heavy.slice/memory.current";
    expect(sliceBytes(facts({ [path]: "4096\n" }).read, 7, "cc-smart-dev-kit-heavy.slice")).toBe(
      4096,
    );
    expect(sliceBytes(facts({}).read, 7, "cc-smart-dev-kit-heavy.slice")).toBeNull();
  });

  // The weights go on every slice of this chain: systemd shares CPU and I/O between
  // slices that are siblings, so only the outermost one competes with the desktop.
  test("the slice chain, outermost first, and the user manager's cgroup", () => {
    expect(sliceChain("cc-smart-dev-kit-heavy.slice")).toEqual([
      "cc.slice",
      "cc-smart.slice",
      "cc-smart-dev.slice",
      "cc-smart-dev-kit.slice",
      "cc-smart-dev-kit-heavy.slice",
    ]);
    expect(sliceChain("solo.slice")).toEqual(["solo.slice"]);
    expect(userManagerCgroup(1000)).toBe("/user.slice/user-1000.slice/user@1000.service");
  });

  test("the user manager's delegated controllers, or null when it cannot be read", () => {
    const path = `/sys/fs/cgroup${userManagerCgroup(7)}/cgroup.controllers`;
    expect(userManagerControllers(facts({ [path]: "cpu memory pids\n" }).read, 7)).toEqual([
      "cpu",
      "memory",
      "pids",
    ]);
    expect(userManagerControllers(facts({ [path]: "\n" }).read, 7)).toEqual([]);
    expect(userManagerControllers(facts({}).read, 7)).toBeNull();
  });
});
