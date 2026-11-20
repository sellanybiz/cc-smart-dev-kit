/** The memoized real path (`real-path.ts`): the answers are written by hand. */
import { describe, expect, test as it } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { memoizedRealPath } from "./real-path";

describe("memoizedRealPath", () => {
  it("resolves a link on the way to a path", () => {
    const root = tempDir("real-path");
    mkdirSync(join(root, "target", "deep"), { recursive: true });
    symlinkSync(join(root, "target"), join(root, "link"));
    const real = memoizedRealPath();
    expect(real(join(root, "link", "deep"))).toBe(join(root, "target", "deep"));
  });

  it("answers a path that is not there as its folder's real path and its own name", () => {
    const root = tempDir("real-path");
    mkdirSync(join(root, "target"));
    symlinkSync(join(root, "target"), join(root, "link"));
    const real = memoizedRealPath();
    expect(real(join(root, "link", "missing", "x"))).toBe(join(root, "target", "missing", "x"));
  });

  it("remembers an answer: a link that changes later is not read again", () => {
    const root = tempDir("real-path");
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    symlinkSync(join(root, "a"), join(root, "link"));
    const real = memoizedRealPath();
    expect(real(join(root, "link"))).toBe(join(root, "a"));
    rmSync(join(root, "link"));
    symlinkSync(join(root, "b"), join(root, "link"));
    expect(real(join(root, "link"))).toBe(join(root, "a"));
    // A second reader has its own memory and sees the link as it is now.
    expect(memoizedRealPath()(join(root, "link"))).toBe(join(root, "b"));
  });
});
