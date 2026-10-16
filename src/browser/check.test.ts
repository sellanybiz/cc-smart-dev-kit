/**
 * `browserCheckCommand`: the command each of the check's two sessions runs. Pure, so it is
 * tested here; the check itself drives the real Chrome and the real Playwright MCP, and is
 * run by hand (`cc-smart-dev-kit browser check`).
 */
import { describe, expect, test } from "bun:test";
import { browserCheckCommand } from "./check";

describe("browserCheckCommand", () => {
  test("this bun, the plugin's two flags, and this bundle", () => {
    expect(
      browserCheckCommand(
        "/opt/bun/bin/bun",
        "/plugins/cc-smart-dev-kit/dist/cli.js",
        "/plugins/cc-smart-dev-kit",
      ),
    ).toEqual([
      "/opt/bun/bin/bun",
      "--no-env-file",
      "--config=/plugins/cc-smart-dev-kit/bunfig.toml",
      "/plugins/cc-smart-dev-kit/dist/cli.js",
    ]);
  });
});
