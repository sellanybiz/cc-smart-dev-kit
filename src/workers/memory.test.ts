/**
 * The memory a worker's process holds (`memory.ts`): `/proc/<pid>/status`'s `VmRSS` on Linux,
 * nothing anywhere else.
 */
import { describe, expect, test } from "bun:test";
import { memoryMbOf } from "./memory";

describe("the memory a worker's process holds", () => {
  test("D35: on Linux it reads the resident set of the process", () => {
    if (process.platform !== "linux") return;
    const memory = memoryMbOf(process.pid);
    expect(memory).not.toBeNull();
    expect(memory ?? 0).toBeGreaterThan(0);
    // MB with one decimal: a process of this size is under a gigabyte.
    expect(memory ?? 0).toBeLessThan(1024);
  });

  test("D35: a process that is gone, or never was, has no memory", () => {
    expect(memoryMbOf(null)).toBeNull();
    expect(memoryMbOf(0)).toBeNull();
    expect(memoryMbOf(-1)).toBeNull();
    expect(memoryMbOf(999_999_999)).toBeNull();
  });
});
