import { expect, test } from "bun:test";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { emptyConfig, saveConfig } from "../gateway/config";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { tempDir } from "../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "./actions";
import { testPortalContext } from "./api/test-context";

test("D64: the portal judge preview tests the target at its pin", async () => {
  const sent: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (req.method === "GET") return Response.json({ data: [{ id: "model" }] });
      sent.push(await req.json());
      return Response.json({ content: [{ type: "text", text: "<block>yes</block>" }] });
    },
  });
  try {
    const home = tempDir("judge-effort-preview");
    const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    saveConfig(paths.gatewayConfigFile, {
      ...emptyConfig(),
      port: 21111,
      backends: { backend: { apiKey: "fake-key", baseUrl: `http://127.0.0.1:${server.port}` } },
      slots: { "cc-smart-dev-kit-judge": ["backend:model"] },
      effort: { "cc-smart-dev-kit-judge": { "backend:model": "xhigh" } },
    });
    const portal = testPortalContext(paths, { HOME: home }, Date.now);
    const action: ActionContext = {
      cwd: home,
      portal,
      omniroute: portalOmnirouteContext(portal),
      workflow: fakeWorkflow(),
      projectDefaults: () => fakeDefaults(),
    };
    const answer = await runAction(
      "slot.test",
      { slot: "judge", targets: ["backend:model"] },
      action,
    );
    expect(answer.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ output_config: { effort: "xhigh" } });
  } finally {
    server.stop(true);
  }
});
