/**
 * RV3: the portal's OmniRoute actions are the person's click, never a Claude Code session's.
 *
 * `omniroute update` and `omniroute rollback` refuse when `CLAUDECODE` is set (they restart the
 * program a session's affordable slots answer from). The portal usually starts from a SessionStart
 * hook, so its own environment holds `CLAUDECODE=1`; its CLI children drop it
 * (`cliChildEnv`, `.claude/rules/portal.md`), and the OmniRoute actions, which run in the
 * portal's own process, must not hand it to the command either.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { tempDir } from "../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "./actions";
import { testPortalContext } from "./api/test-context";

const REFUSAL = "cannot run inside a Claude Code session";

test.each([["omniroute.update"], ["omniroute.rollback"]] as const)(
  "%s from a portal that inherited CLAUDECODE is the person's click, not a refused session",
  async (name) => {
    const home = tempDir("portal-omniroute");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const portal = testPortalContext(paths, { CLAUDECODE: "1", HOME: home }, Date.now);
    const action: ActionContext = {
      cwd: home,
      omniroute: portalOmnirouteContext(portal),
      portal,
      projectDefaults: () => fakeDefaults(),
      workflow: fakeWorkflow(),
    };
    const answer = await runAction(name, {}, action);
    expect(answer.lines.join("\n")).not.toContain(REFUSAL);
  },
);
