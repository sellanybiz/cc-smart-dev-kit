/**
 * How long a test that starts the CLI or the installer as a real process may take.
 *
 * Such a test waits for a process, a temp HOME and git calls. On a busy machine (a build,
 * the whole suite at once) one of those can pass Bun's 5 s default while the behaviour under
 * test is right: seen on 2026-10-21, at a load average near 60, three process tests timed out
 * and passed alone. So this is a speed limit, not an assertion: it changes nothing a test
 * checks.
 *
 * A file that starts the CLI or the installer calls `setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS)`
 * once, at its top. That sets the file's own default, and it wins over `bun test --timeout`
 * (checked on Bun 1.4.3): the file always gets at least this long.
 */
export const PROCESS_TEST_TIMEOUT_MS = 60_000;
