import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { stdoutMayBePiped } from "./stdout-pipe";

test("a FIFO or socket stdout may be a pipe; a file or a terminal is not", () => {
  expect(stdoutMayBePiped({ platform: "linux", isPipe: () => true })).toBe(true);
  expect(stdoutMayBePiped({ platform: "linux", isPipe: () => false })).toBe(false);
  expect(stdoutMayBePiped({ platform: "darwin", isPipe: () => false })).toBe(false);
});

test("Windows and a stat that fails count as a pipe, so the hint is never lost", () => {
  expect(stdoutMayBePiped({ platform: "win32", isPipe: () => false })).toBe(true);
  const failing = () => {
    throw new Error("EBADF: bad file descriptor");
  };
  expect(stdoutMayBePiped({ platform: "linux", isPipe: failing })).toBe(true);
});

test("the live answer reads this process's own stdout: a pipe yes, a file no", () => {
  const script = `import { stdoutMayBePiped } from ${JSON.stringify(join(import.meta.dir, "stdout-pipe.ts"))}; process.stderr.write(String(stdoutMayBePiped()));`;
  const piped = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe" });
  expect(piped.stderr.toString()).toBe("true");
  // Windows counts every stdout as a pipe (the module's header says why).
  const expectedForFile = process.platform === "win32" ? "true" : "false";
  const out = join(tempDir("stdout-pipe"), "out.txt");
  const toFile = Bun.spawnSync([process.execPath, "-e", script], { stdout: Bun.file(out) });
  expect(toFile.stderr.toString()).toBe(expectedForFile);
});
