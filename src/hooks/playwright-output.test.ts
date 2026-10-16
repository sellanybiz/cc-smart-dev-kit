/**
 * The Playwright output hook: a screenshot the caller names by a relative `filename` goes into
 * the browser's output folder, and a name that climbs out of it is refused.
 *
 * The measurement behind it (`docs/claude-code-contract.md` § The browser): with
 * `@playwright/mcp` 0.0.83 and `--output-dir`, a caller-named file lands in the MCP process's
 * cwd; a server-named one lands in the output folder. The launcher passes
 * `--allow-unrestricted-file-access`, so the server itself writes a `../x.png` wherever it
 * points — this hook is the one that refuses it.
 *
 * The hook answers only while the live `playwright` registration is the plugin's own: a
 * person's server of that name has its own output folder and is none of its business.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { markMcpServerPending, recordMcpServer } from "../mcp/records";
import { hookEnv, runEntry } from "../testing/hooks";
import { outputFilename, playwrightIsOurs, playwrightOutputAnswer } from "./playwright-output";

const OUTPUT = "/data/cc-smart-dev-kit/playwright-output";

/** What the hook answered, parsed. */
function hookOutput(result: { stdout?: string }): {
  permissionDecision?: string;
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
} {
  return (
    (
      JSON.parse(result.stdout ?? "{}") as {
        hookSpecificOutput?: {
          permissionDecision?: string;
          permissionDecisionReason?: string;
          updatedInput?: Record<string, unknown>;
        };
      }
    ).hookSpecificOutput ?? {}
  );
}

/** A home whose record and user config say the plugin registered `playwright` itself. */
function pluginHome(
  home: string,
  options: { liveJson?: string; pending?: boolean; recordJson?: string } = {},
): ReturnType<typeof cliPaths> {
  const paths_ = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const json = options.recordJson ?? JSON.stringify({ args: ["browser", "mcp"], command: "/l" });
  recordMcpServer(paths_.stateDir, "playwright", json, "then");
  if (options.pending === true) markMcpServerPending(paths_.stateDir, "playwright");
  mkdirSync(dirname(paths_.userConfigFile), { recursive: true });
  writeFileSync(
    paths_.userConfigFile,
    JSON.stringify({ mcpServers: { playwright: JSON.parse(options.liveJson ?? json) } }),
  );
  return paths_;
}

describe("the rewritten filename", () => {
  test("a relative name becomes an absolute path in the output folder", () => {
    expect(outputFilename({ filename: "home-dark.png" }, OUTPUT)).toBe(
      join(OUTPUT, "home-dark.png"),
    );
  });

  test("`./x.png` means `x.png` there; a nested name keeps its folders", () => {
    expect(outputFilename({ filename: "./x.png" }, OUTPUT)).toBe(join(OUTPUT, "x.png"));
    expect(outputFilename({ filename: "shots/x.png" }, OUTPUT)).toBe(join(OUTPUT, "shots/x.png"));
  });

  test("left alone: an absolute path", () => {
    expect(outputFilename({ filename: "/tmp/x.png" }, OUTPUT)).toBeNull();
  });

  test("left alone: no filename, an empty one, or one that is not a string", () => {
    expect(outputFilename({}, OUTPUT)).toBeNull();
    expect(outputFilename({ filename: "" }, OUTPUT)).toBeNull();
    expect(outputFilename({ filename: 7 }, OUTPUT)).toBeNull();
  });
});

describe("the answer for the plugin's own server", () => {
  test("the changed input, with every other field kept", () => {
    const result = playwrightOutputAnswer(
      {
        tool_input: { filename: "home-dark.png", fullPage: true, type: "png" },
        tool_name: "mcp__playwright__browser_take_screenshot",
      },
      OUTPUT,
      true,
    );
    const output = hookOutput(result);
    // Never a permission decision: the call still goes through the normal flow.
    expect(output.permissionDecision).toBeUndefined();
    expect(output.updatedInput).toEqual({
      filename: join(OUTPUT, "home-dark.png"),
      fullPage: true,
      type: "png",
    });
  });

  test("a name that climbs out of the folder is refused, with the reason", () => {
    for (const filename of ["../x.png", "shots/../../x.png", "..\\x.png"]) {
      const output = hookOutput(playwrightOutputAnswer({ tool_input: { filename } }, OUTPUT, true));
      expect(output.permissionDecision).toBe("deny");
      expect(output.permissionDecisionReason).toContain(
        `This call names a file outside the browser's output folder ("filename": ${JSON.stringify(filename)} — a path with ".." in it).`,
      );
      expect(output.permissionDecisionReason).toContain(OUTPUT);
      expect(output.updatedInput).toBeUndefined();
    }
  });

  test("a call it leaves alone answers nothing at all", () => {
    expect(
      playwrightOutputAnswer(
        {
          tool_input: { filename: "/tmp/x.png" },
          tool_name: "mcp__playwright__browser_take_screenshot",
        },
        OUTPUT,
        true,
      ),
    ).toEqual({});
    expect(
      playwrightOutputAnswer(
        { tool_input: { url: "http://x/" }, tool_name: "mcp__playwright__browser_navigate" },
        OUTPUT,
        true,
      ),
    ).toEqual({});
  });
});

describe("a server that is not the plugin's own", () => {
  test("nothing is answered — no rewrite, and no refusal either", () => {
    for (const tool_input of [{ filename: "x.png" }, { filename: "../x.png" }]) {
      expect(
        playwrightOutputAnswer(
          { tool_input, tool_name: "mcp__playwright__browser_take_screenshot" },
          OUTPUT,
          false,
        ),
      ).toEqual({});
    }
  });

  test("the live registration is ours only while the record says so", () => {
    const home = hookEnv().HOME ?? "";
    // A record and a user config that match, not pending: ours.
    expect(playwrightIsOurs(pluginHome(home))).toBe(true);
    // Marked pending (an update was in flight): not ours.
    expect(playwrightIsOurs(pluginHome(join(home, "pending"), { pending: true }))).toBe(false);
    // The user config holds something else under the name: the person's.
    expect(
      playwrightIsOurs(
        pluginHome(join(home, "changed"), { liveJson: JSON.stringify({ command: "/theirs" }) }),
      ),
    ).toBe(false);
    // No record at all (a project's own `.mcp.json` server, or a machine that never ran
    // setup): not ours.
    const fresh = cliPaths({
      CLAUDE_CONFIG_DIR: join(home, "fresh", ".claude"),
      HOME: join(home, "fresh"),
    });
    expect(playwrightIsOurs(fresh)).toBe(false);
  });
});

describe("as Claude Code runs it", () => {
  test("the entry reads the input and puts the file in the machine's output folder", () => {
    const env = hookEnv();
    const paths_ = pluginHome(env.HOME ?? "");
    const result = runEntry(
      "playwright-output",
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "11111111-2222-3333-4444-555555555555",
        tool_name: "mcp__playwright__browser_take_screenshot",
        tool_input: { filename: "check.png" },
      }),
      env,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(hookOutput(result).updatedInput).toEqual({
      filename: join(paths_.browserOutputDir, "check.png"),
    });
  });

  test("the entry refuses a climbing name on the plugin's own server", () => {
    const env = hookEnv();
    pluginHome(env.HOME ?? "");
    const result = runEntry(
      "playwright-output",
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "mcp__playwright__browser_take_screenshot",
        tool_input: { filename: "../../escape.png" },
      }),
      env,
    );
    expect(result.exitCode).toBe(0);
    expect(hookOutput(result).permissionDecision).toBe("deny");
  });

  test("a machine with no record of the plugin's playwright: nothing, and exit 0", () => {
    const env = hookEnv();
    const result = runEntry(
      "playwright-output",
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "mcp__playwright__browser_take_screenshot",
        tool_input: { filename: "check.png" },
      }),
      env,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("an input that is not JSON: nothing, and exit 0", () => {
    const result = runEntry("playwright-output", "not json", hookEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
