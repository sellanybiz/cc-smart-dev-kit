// Preloaded before every test file (bunfig.toml): hooks here apply to every test.
import { afterAll, afterEach } from "bun:test";
import { bunTooOld } from "../build-info/bun";
import { installPortGuard, removeSubprocessLog, takeViolations } from "./port-guard";
import { removeTempDirs } from "./temp";

// The tests need the Bun anymodel needs: on an older one the proxy tests fail, and the CLI
// they start refuses to run. One clear line instead of a page of failures: exit, because
// a throw here is reported once per test file.
const tooOld = bunTooOld(Bun.version, process.execPath);
if (tooOld !== null) {
  console.error(`${tooOld} The tests need it too. Run them with a newer Bun.`);
  process.exit(1);
}

// No test may reach the live router's port (port-guard.ts). A call fails the test that made
// it, even when the code under test caught the error.
installPortGuard();

afterEach(() => {
  removeTempDirs();
  const violations = takeViolations();
  if (violations.length > 0) {
    throw new Error(`port guard:\n${violations.join("\n")}`);
  }
});

afterAll(removeSubprocessLog);
