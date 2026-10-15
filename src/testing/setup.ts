// Preloaded before every test file (bunfig.toml): hooks here apply to every test.
import { afterAll, afterEach } from "bun:test";
import { installPortGuard, removeSubprocessLog, takeViolations } from "./port-guard";
import { removeTempDirs } from "./temp";

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
