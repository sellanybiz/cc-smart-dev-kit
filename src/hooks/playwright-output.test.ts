/**
 * The Playwright output hook: a screenshot the caller names by a relative `filename` goes into
 * the shared browser's output folder, never beside the project's files.
 *
 * The measurement behind it (`docs/claude-code-contract.md` § The shared browser): with
 * `@playwright/mcp` 0.0.83 and `--output-dir`, a caller-named file lands in the MCP process's
 * cwd; a server-named one lands in the output folder.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, runEntry } from "../testing/hooks";
import { outputFilename, playwrightOutputAnswer } from "./playwright-output";

const OUTPUT = "/data/cc-smart-dev-kit/playwright-output";

/** What the hook answered, parsed. */
function updatedInput(result: { stdout?: string }): Record<string, unknown> | undefined {
  const output = (
    JSON.parse(result.stdout ?? "{}") as {
      hookSpecificOutput?: { permissionDecision?: string; updatedInput?: Record<string, unknown> };
    }
  ).hookSpecificOutput;
  // Never a permission decision: the call still goes through the normal flow.
  expect(output?.permissionDecision).toBeUndefined();
  return output?.updatedInput;
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

  test("left alone: an absolute path, and a name that climbs out of the folder", () => {
    expect(outputFilename({ filename: "/tmp/x.png" }, OUTPUT)).toBeNull();
    expect(outputFilename({ filename: "../x.png" }, OUTPUT)).toBeNull();
    expect(outputFilename({ filename: "shots/../../x.png" }, OUTPUT)).toBeNull();
  });

  test("left alone: no filename, an empty one, or one that is not a string", () => {
    expect(outputFilename({}, OUTPUT)).toBeNull();
    expect(outputFilename({ filename: "" }, OUTPUT)).toBeNull();
    expect(outputFilename({ filename: 7 }, OUTPUT)).toBeNull();
  });
});

describe("the answer", () => {
  test("the changed input, with every other field kept", () => {
    const result = playwrightOutputAnswer(
      {
        tool_input: { filename: "home-dark.png", fullPage: true, type: "png" },
        tool_name: "mcp__playwright__browser_take_screenshot",
      },
      OUTPUT,
    );
    expect(updatedInput(result)).toEqual({
      filename: join(OUTPUT, "home-dark.png"),
      fullPage: true,
      type: "png",
    });
  });

  test("a call it leaves alone answers nothing at all", () => {
    expect(
      playwrightOutputAnswer(
        {
          tool_input: { filename: "/tmp/x.png" },
          tool_name: "mcp__playwright__browser_take_screenshot",
        },
        OUTPUT,
      ),
    ).toEqual({});
    expect(
      playwrightOutputAnswer(
        { tool_input: { url: "http://x/" }, tool_name: "mcp__playwright__browser_navigate" },
        OUTPUT,
      ),
    ).toEqual({});
  });
});

describe("as Claude Code runs it", () => {
  test("the entry reads the input and puts the file in the machine's output folder", () => {
    const env = hookEnv();
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
    expect(updatedInput(result)).toEqual({
      filename: join(cliPaths(env).browserOutputDir, "check.png"),
    });
  });

  test("an input that is not JSON: nothing, and exit 0", () => {
    const result = runEntry("playwright-output", "not json", hookEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
