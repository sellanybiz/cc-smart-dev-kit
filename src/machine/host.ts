/**
 * The host's own facts, in one home: the operating system the plugin is running on.
 *
 * A test on a Linux or macOS machine cannot change `process.platform`, and the Windows
 * rules (the home folder, the launcher's `.cmd` twin, Git Bash, the file modes) must be
 * tested all the same. So the platform is read through `TEST_HOST_VAR` here, exactly as
 * `Machine` reads the rest of the host's facts (`machine.ts`), and a test asks for the
 * Windows rules by setting it. Unset — every real run — it is `process.platform`.
 */

/**
 * Tests only: a JSON object in this variable stands in for the host's facts (`platform`,
 * `arch`, `osRelease`, `macApp`), so a test that runs the CLI as its own process never
 * reads the machine it runs on. Unset, the real values are used.
 */
export const TEST_HOST_VAR = "CC_SMART_DEV_KIT_TEST_HOST";

/** The platform a test asked for, or this machine's. */
export function hostPlatform(
  env: Record<string, string | undefined> = process.env,
): NodeJS.Platform {
  const text = env[TEST_HOST_VAR];
  if (!text) return process.platform;
  const given = JSON.parse(text) as { platform?: NodeJS.Platform };
  return given.platform ?? process.platform;
}
