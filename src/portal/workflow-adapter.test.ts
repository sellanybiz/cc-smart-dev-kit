/**
 * The portal's Project card defaults: the CLI's own answers (`defaultAnswers`), with one
 * rule of the portal's own — the form does not show `checks`, so a check detected from
 * `package.json` must never reach a Preview or a Write.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { workflowAdapter } from "./workflow-adapter";

describe("the Project card's defaults", () => {
  test("a detected package.json check is not an answer: the form cannot choose it", async () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ scripts: { check: "bun test", typecheck: "tsc --noEmit" } })}\n`,
    );
    const defaults = await workflowAdapter.projectInitDefaults({ env: hookEnv(), root: repo });
    expect(defaults.answers).not.toHaveProperty("checks");
  });

  test("the project's own checks.fast passes through: the plan keeps it as the file has it", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      checks: { fast: "bun run check" },
      worktrees: { base: "main" },
    });
    const defaults = await workflowAdapter.projectInitDefaults({ env: hookEnv(), root: repo });
    expect(defaults.answers.checks).toEqual({ fast: "bun run check" });
  });
});
