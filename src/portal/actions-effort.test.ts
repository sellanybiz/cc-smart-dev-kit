import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { emptyConfig, loadConfigFile, saveConfig } from "../gateway/config";
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

/** A fake backend that records each test request and answers with the status the test picks. */
function fakeBackend(status = 200) {
  const sent: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (req.method === "GET") return Response.json({ data: [{ id: "model" }] });
      sent.push((await req.json()) as Record<string, unknown>);
      return status === 200
        ? Response.json({ content: [{ type: "text", text: "<block>yes</block>" }] })
        : Response.json({ error: { message: "effort max is not supported" } }, { status });
    },
  });
  return { sent, server };
}

/** A gateway config with one backend at `port`, the scout chain, and the pins given. */
function effortWorld(port: number, effort?: Record<string, Record<string, "low" | "xhigh">>) {
  const home = tempDir("effort-action");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  saveConfig(paths.gatewayConfigFile, {
    ...emptyConfig(),
    port: 21111,
    backends: { backend: { apiKey: "fake-key", baseUrl: `http://127.0.0.1:${port}` } },
    slots: { "cc-smart-dev-kit-scout": ["backend:model", "claude-haiku-5-5"] },
    ...(effort === undefined ? {} : { effort }),
  });
  const portal = testPortalContext(paths, { HOME: home }, Date.now, {
    pluginFolder: () => ({ folder: tempDir("effort-plugin") }),
  });
  const action: ActionContext = {
    cwd: home,
    portal,
    omniroute: portalOmnirouteContext(portal),
    workflow: fakeWorkflow(),
    projectDefaults: () => fakeDefaults(),
  };
  return { action, file: paths.gatewayConfigFile };
}

describe("D64: slot.effort runs the CLI's own `gateway effort`", () => {
  test("pins a backend target after one test request at that level", async () => {
    const { sent, server } = fakeBackend();
    try {
      const { action, file } = effortWorld(server.port);
      const answer = await runAction(
        "slot.effort",
        { level: "xhigh", slot: "scout", target: "backend:model" },
        action,
      );
      expect(answer.ok).toBe(true);
      expect(answer.lines.join("\n")).toContain(
        "cc-smart-dev-kit-scout: backend:model [effort xhigh] → claude-haiku-5-5",
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ output_config: { effort: "xhigh" } });
      expect(loadConfigFile(file).effort).toEqual({
        "cc-smart-dev-kit-scout": { "backend:model": "xhigh" },
      });
    } finally {
      server.stop(true);
    }
  });

  test("a level the backend refuses is not saved, and the refusal is the answer", async () => {
    const { server } = fakeBackend(400);
    try {
      const { action, file } = effortWorld(server.port);
      const answer = await runAction(
        "slot.effort",
        { level: "max", slot: "scout", target: "backend:model" },
        action,
      );
      expect(answer.ok).toBe(false);
      expect(answer.lines.join("\n")).toContain("backend:model refused effort max");
      expect(answer.lines.join("\n")).toContain("Nothing was saved.");
      expect(loadConfigFile(file).effort).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("off unpins, with no test request outside the judge", async () => {
    const { sent, server } = fakeBackend();
    try {
      const { action, file } = effortWorld(server.port, {
        "cc-smart-dev-kit-scout": { "backend:model": "low" },
      });
      const answer = await runAction(
        "slot.effort",
        { level: "off", slot: "scout", target: "backend:model" },
        action,
      );
      expect(answer.ok).toBe(true);
      expect(sent).toHaveLength(0);
      expect(loadConfigFile(file).effort).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("a Claude target is refused in the command's words", async () => {
    const { sent, server } = fakeBackend();
    try {
      const { action, file } = effortWorld(server.port);
      const answer = await runAction(
        "slot.effort",
        { level: "high", slot: "scout", target: "claude-haiku-5-5" },
        action,
      );
      expect(answer.ok).toBe(false);
      expect(answer.lines.join("\n")).toContain("a Claude target cannot pin effort");
      expect(sent).toHaveLength(0);
      expect(loadConfigFile(file).effort).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("a body the command would refuse is refused before anything runs", async () => {
    const { sent, server } = fakeBackend();
    try {
      const { action } = effortWorld(server.port);
      for (const body of [
        { level: "huge", slot: "scout", target: "backend:model" },
        { level: 3, slot: "scout", target: "backend:model" },
        { level: "high", slot: "scout" },
        { level: "high", target: "backend:model" },
        { level: "high", slot: "scout", target: "" },
      ]) {
        expect(await runAction("slot.effort", body, action)).toEqual({
          lines: ["Pick a slot, one of its backend targets, and a level or off."],
          ok: false,
        });
      }
      expect(sent).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });
});
