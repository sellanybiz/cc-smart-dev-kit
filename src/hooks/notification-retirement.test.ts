import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("the shipped manifest still guards questions and plan approval while the person is away", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dir, "../../plugin/hooks/hooks.json"), "utf8"),
  );
  for (const tool of ["AskUserQuestion", "ExitPlanMode"]) {
    const handlers = manifest.hooks.PreToolUse.filter((group: { matcher: string }) =>
      new RegExp(`^(?:${group.matcher})$`).test(tool),
    ).flatMap((group: { hooks: unknown[] }) => group.hooks);
    expect(handlers).toEqual([
      {
        type: "command",
        command: `"\${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh" --missing=ask "\${CLAUDE_PLUGIN_ROOT}/dist/user-away.js"`,
        onFailure: "block",
        timeout: 10,
      },
    ]);
  }
});
