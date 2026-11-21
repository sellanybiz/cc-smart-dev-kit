// The one home every test runs with. The preload (`setup.ts`) makes it before any test file
// loads, points the process's home variables at it and replaces `os.homedir()`, so no path that
// falls back to "the home folder" can land in the real one.
import { mock } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import osDefault, * as os from "node:os";
import { join } from "node:path";

// Read before `installTestHome` replaces `os.homedir()`: this module loads first.
const realHome = os.homedir();
const realOs = { ...os };
const realOsDefault = { ...osDefault };

let home: string | null = null;

/** The real home folder of the person running the tests. Only a proof test may read it. */
export function realHomeDir(): string {
  return realHome;
}

/**
 * The real `node:os` as it was before the preload replaced `homedir`: its named exports, and
 * its default export. Copies, so the mock cannot change them. Only a proof test reads them.
 */
export function realOsModule(): { named: typeof os; default: typeof osDefault } {
  return { named: realOs, default: realOsDefault };
}

/** The temp home of this test run. Throws before the preload has made it. */
export function testHome(): string {
  if (home === null) throw new Error("the test home is not installed: the preload makes it");
  return home;
}

/**
 * The variables that name the home and the folders under it, all inside the temp home.
 * `CLAUDE_CONFIG_DIR` is set too, so a child that loses every `CLAUDE_*` variable to
 * `cleanGitEnv()` still lands in `<home>/.claude` through its `HOME`.
 */
export function testHomeEnv(): Record<string, string> {
  const dir = testHome();
  return {
    HOME: dir,
    USERPROFILE: dir,
    CLAUDE_CONFIG_DIR: join(dir, ".claude"),
    XDG_CONFIG_HOME: join(dir, ".config"),
    XDG_STATE_HOME: join(dir, ".local", "state"),
    XDG_DATA_HOME: join(dir, ".local", "share"),
  };
}

/**
 * The environment for a child process a test starts with a hand-built env: the given variables
 * on top of the test home's, so the child never falls back to the real home. The caller's own
 * `HOME` or `CLAUDE_CONFIG_DIR` wins.
 */
export function childEnv(vars: Record<string, string> = {}): Record<string, string> {
  return { ...testHomeEnv(), ...vars };
}

/**
 * Makes the temp home, writes it into `process.env` and makes `os.homedir()` answer it.
 * Not `tempDir()`: that removes its folders after each test, and this one lives for the run.
 */
export function installTestHome(): void {
  if (home !== null) return;
  home = realpathSync(mkdtempSync(join(os.tmpdir(), "cc-smart-dev-kit-home-")));
  Object.assign(process.env, testHomeEnv());
  // Every other export of `node:os` stays as it was; both the named and the default import
  // of the module see the new `homedir`.
  const replaced = { ...realOsDefault, homedir: () => testHome() };
  mock.module("node:os", () => ({ ...replaced, default: replaced }));
  mock.module("os", () => ({ ...replaced, default: replaced }));
}

/** Removes the temp home. The preload runs it once, after the last test. */
export function removeTestHome(): void {
  if (home === null) return;
  rmSync(home, { recursive: true, force: true });
}
