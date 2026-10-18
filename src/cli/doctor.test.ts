/** `doctor`'s line for the user-level `Notification` hook setup writes for agent view. */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { hookEnv } from "../testing/hooks";
import { checkLine, checkUserNotifyHook } from "./doctor";
import { cliPaths } from "./paths";

const COMMAND = '"$HOME/.local/bin/cc-smart-dev-kit" hook notify';
const SETTINGS = "~/.claude/settings.json";

/** The line doctor prints for a settings file holding `hooks`, written by hand. */
function line(hooks: unknown): string {
  const env = hookEnv();
  const paths = cliPaths(env);
  if (hooks !== undefined) {
    writeFileSync(paths.settingsFile, `${JSON.stringify({ hooks }, null, 2)}\n`);
  }
  return checkLine(checkUserNotifyHook(paths));
}

describe("doctor: agent view's notification hook", () => {
  test("missing: ✗, and the command to run", () => {
    expect(line(undefined)).toBe(
      `✗ agent view's notification hook is missing from ${SETTINGS}, so agent view's alerts never arrive. Run: cc-smart-dev-kit setup`,
    );
  });

  test("a hook with the matcher that runs something else: ✗, and the command to run", () => {
    expect(
      line({ Notification: [{ matcher: "agent_needs_input|agent_completed", hooks: [] }] }),
    ).toBe(
      `✗ agent view's notification hook in ${SETTINGS} does not run ${COMMAND}, so agent view's alerts never reach the notifier. Run: cc-smart-dev-kit setup`,
    );
  });

  test("a person-edited managed entry: · information, never a failure", () => {
    expect(
      line({
        Notification: [
          {
            matcher: "agent_needs_input|agent_completed",
            hooks: [{ type: "command", command: `${COMMAND} 2>>log`, timeout: 30 }],
          },
        ],
      }),
    ).toBe(
      `· agent view's notification hook in ${SETTINGS} was edited since setup wrote it; it still runs ${COMMAND}, and cc-smart-dev-kit leaves it alone`,
    );
  });

  test("the managed entry: ✓, with the command", () => {
    expect(
      line({
        Notification: [
          {
            matcher: "agent_needs_input|agent_completed",
            hooks: [{ type: "command", command: COMMAND, timeout: 10 }],
          },
        ],
      }),
    ).toBe(`✓ agent view's notification hook is set in ${SETTINGS}: ${COMMAND}`);
  });
});
