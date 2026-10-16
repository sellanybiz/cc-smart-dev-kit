/**
 * The two halves of the mode rule: setting a file's bits (`setFileMode`), and answering whether a
 * file is its owner's alone (`isOwnerOnly`) — what every reader that refuses a shared file asks
 * (the browser's token, the gateway's config, the Tavily key file, the browser's output folder).
 *
 * Windows makes its modes up (`statSync().mode` reports 0666 for a writable file, 0444 for a
 * read-only one, whatever the ACL says) and does not implement `fchmod`, so the assertions on real
 * bits and the fatal-failure cases are marked POSIX-only, and each has a Windows twin here: this
 * file runs in the Windows job too. `isOwnerOnly` needs no file system at all.
 */
import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { isOwnerOnly, setFileMode } from "./file-mode";

/** Windows makes the modes up and does not implement `fchmod`: these assertions need POSIX. */
const NO_POSIX_MODES = process.platform === "win32";

/** A file in a temp folder, so nothing here can touch the machine it runs on. */
function aFile(): string {
  const path = join(tempDir("file-mode"), "a-secret");
  writeFileSync(path, "s3cret\n");
  return path;
}

describe("isOwnerOnly", () => {
  test("off Windows the bits decide: the owner's alone, or shared", () => {
    expect(isOwnerOnly(0o600, "linux")).toBe(true);
    expect(isOwnerOnly(0o700, "linux")).toBe(true);
    expect(isOwnerOnly(0o400, "darwin")).toBe(true);
    expect(isOwnerOnly(0o640, "linux")).toBe(false); // the group can read it
    expect(isOwnerOnly(0o604, "linux")).toBe(false); // others can read it
    expect(isOwnerOnly(0o666, "linux")).toBe(false);
    expect(isOwnerOnly(0o777, "darwin")).toBe(false);
  });

  test("on Windows every file counts as the owner's alone: a mode there says nothing", () => {
    // The two numbers Windows reports: 0o100666 for a writable file, 0o100444 for a read-only
    // one. A refusal over those bits refuses every file the plugin owns — a router on its
    // fallback config, a token file that reads as "readable by others" — so the profile's ACL
    // is trusted instead.
    expect(isOwnerOnly(0o100666, "win32")).toBe(true);
    expect(isOwnerOnly(0o100444, "win32")).toBe(true);
    expect(isOwnerOnly(0o666, "win32")).toBe(true);
    expect(isOwnerOnly(0o777, "win32")).toBe(true);
  });

  test("with no platform given, this machine's decides", () => {
    // The Windows job runs this too: there the default is `win32`, so a shared-looking 0o666
    // file must count as the owner's alone. Off Windows it must not.
    expect(isOwnerOnly(0o666)).toBe(process.platform === "win32");
    expect(isOwnerOnly(0o600)).toBe(true);
  });
});

describe("setFileMode", () => {
  test.skipIf(NO_POSIX_MODES)("off Windows it sets the bits, and a failure is thrown", () => {
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
    // A real file on Windows: the call is made (it only toggles the read-only attribute there),
    // and what matters is that the content is written and correct.
    const path = aFile();
    expect(() => {
      setFileMode(path, 0o600, "win32");
    }).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe("s3cret\n");
  });

  test.skipIf(NO_POSIX_MODES)(
    "an open file descriptor: a real fchmod, and a closed one throws",
    () => {
      const fd = openSync(aFile(), "r+");
      try {
        // On Linux and macOS this is a real fchmod on the descriptor; a throw would fail here.
        setFileMode(fd, 0o600, "linux");
      } finally {
        closeSync(fd);
      }
      // A closed descriptor is the portable stand-in for "the call failed".
      expect(() => setFileMode(fd, 0o600, "linux")).toThrow();
    },
  );

  test("an open file descriptor on Windows: the same failing call is swallowed", () => {
    const fd = openSync(aFile(), "r+");
    closeSync(fd);
    // Windows does not implement fchmod at all; a failure there never ends the run.
    setFileMode(fd, 0o600, "win32");
  });

  test.skipIf(NO_POSIX_MODES)(
    "the mode it was asked for is what the file has, whatever the umask",
    () => {
      const path = aFile();
      writeFileSync(path, "again\n");
      setFileMode(path, 0o755, "linux");
      expect(readFileSync(path, "utf8")).toBe("again\n");
      expect(statSync(path).mode & 0o111).not.toBe(0);
    },
  );
});
