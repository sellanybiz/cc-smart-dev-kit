import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { setFileMode } from "./file-mode";

/** A file in a temp folder, so nothing here can touch the machine it runs on. */
function aFile(): string {
  const path = join(tempDir("file-mode"), "a-secret");
  writeFileSync(path, "s3cret\n");
  return path;
}

describe("setFileMode", () => {
  test("off Windows it sets the bits, and a failure is thrown (the file would be readable)", () => {
    const path = aFile();
    setFileMode(path, 0o600, "linux");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    setFileMode(path, 0o640, "darwin");
    expect(statSync(path).mode & 0o777).toBe(0o640);
    const missing = join(tempDir("file-mode"), "not-there");
    expect(() => setFileMode(missing, 0o600, "linux")).toThrow();
    expect(() => setFileMode(missing, 0o600, "darwin")).toThrow();
  });

  test("on Windows a failing mode call never ends the run: the profile's ACL is the protection", () => {
    // A path that does not exist: on Windows this stands for any chmod that cannot be done
    // (there are no POSIX modes there, and fchmod is not implemented at all).
    const missing = join(tempDir("file-mode"), "not-there");
    expect(() => {
      setFileMode(missing, 0o600, "win32");
    }).not.toThrow();
    expect(() => {
      setFileMode(12345, 0o600, "win32");
    }).not.toThrow();
  });

  test("an open file descriptor: fchmod on Linux and macOS, never fatal on Windows", () => {
    const fd = openSync(aFile(), "r+");
    try {
      // On Linux and macOS this is a real fchmod on the descriptor; a throw would fail here.
      setFileMode(fd, 0o600, "linux");
    } finally {
      closeSync(fd);
    }
    // A closed descriptor is the portable stand-in for "the call failed" (Windows does not
    // implement fchmod at all): fatal off Windows, swallowed there.
    expect(() => setFileMode(fd, 0o600, "linux")).toThrow();
    setFileMode(fd, 0o600, "win32");
  });

  test("the mode it was asked for is what the file has, whatever the umask", () => {
    const path = aFile();
    writeFileSync(path, "again\n");
    setFileMode(path, 0o755, "linux");
    expect(readFileSync(path, "utf8")).toBe("again\n");
    expect(statSync(path).mode & 0o111).not.toBe(0);
  });
});
