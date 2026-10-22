/**
 * How long a test that runs real processes may take: one that starts the CLI or the installer,
 * or one that runs git in real repositories (the background clean's, the escape guard's).
 *
 * Such a test waits for a process, a temp HOME and git calls. On a busy machine (a build,
 * the whole suite at once) one of those can pass Bun's 5 s default while the behaviour under
 * test is right: seen on 2026-10-21, at a load average near 60, three process tests timed out
 * and passed alone; and a Windows CI run on 2026-10-22 had the background clean's tests at
 * 4.3-4.9 s. So this is a speed limit, not an assertion: it changes nothing a test checks.
 *
 * A file that runs such processes calls `setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS)`
 * once, at its top. That sets the file's own default, and it wins over `bun test --timeout`
 * (checked on Bun 1.4.3): the file always gets at least this long.
 */
export const PROCESS_TEST_TIMEOUT_MS = 60_000;
