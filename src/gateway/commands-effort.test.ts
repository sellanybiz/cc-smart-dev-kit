import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { runGateway } from "./commands";
import { emptyConfig, loadConfigFile, saveConfig } from "./config";
import { gatewayContext } from "./context";
import type { HealthFetch } from "./health";

function world(fetchImpl: HealthFetch) {
  const home = tempDir("effort-command");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: `${home}/.claude` });
  saveConfig(paths.gatewayConfigFile, {
    ...emptyConfig(),
    backends: { backend: { apiKey: "backend-secret", baseUrl: "http://backend.test" } },
    port: 21111,
    slots: { "cc-smart-dev-kit-scout": ["backend:model", "claude-haiku-5-5"] },
  });
  const lines: string[] = [];
  const ctx = gatewayContext({
    account: null,
    apiFetch: fetchImpl,
    bundle: "unused",
    confirm: null,
    paths,
    platform: "linux",
    service: "none",
    runner: () => {
      throw new Error("no process should run");
    },
    print: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });
  return { ctx, lines, paths };
}

describe("D64: gateway effort", () => {
  it("tests once with only the backend key, saves live, annotates the chain, and off sends nothing", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const w = world(async (url, init) => {
      calls.push({ url, init });
      return Response.json({ content: [{ type: "text", text: "ok" }] });
    });
    expect(await runGateway(["effort", "scout", "backend:model", "xhigh"], w.ctx)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://backend.test/v1/messages");
    expect(JSON.parse(String(calls[0]?.init?.body)).output_config).toEqual({ effort: "xhigh" });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer backend-secret");
    expect(loadConfigFile(w.paths.gatewayConfigFile).effort).toEqual({
      "cc-smart-dev-kit-scout": { "backend:model": "xhigh" },
    });
    expect(w.lines.join("\n")).toContain("backend:model [effort xhigh] → claude-haiku-5-5");
    expect(w.lines.join("\n")).toContain("next request");
    expect(await runGateway(["effort", "scout", "backend:model", "off"], w.ctx)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(loadConfigFile(w.paths.gatewayConfigFile).effort).toBeUndefined();
  });

  it("refuses a backend's level with its masked reason and saves nothing", async () => {
    const w = world(async () =>
      Response.json(
        { error: { message: "xhigh unsupported backend-secret\u001b[31m" } },
        { status: 400 },
      ),
    );
    const before = readFileSync(w.paths.gatewayConfigFile, "utf8");
    let reason = "";
    try {
      await runGateway(["effort", "scout", "backend:model", "xhigh"], w.ctx);
    } catch (error) {
      reason = String(error);
    }
    expect(reason).toContain("xhigh unsupported");
    expect(reason).not.toContain("backend-secret");
    expect(reason).not.toContain("\u001b");
    expect(readFileSync(w.paths.gatewayConfigFile, "utf8")).toBe(before);
  });

  it("refuses invalid levels, Claude targets and targets outside the slot before any request", async () => {
    const w = world(async () => {
      throw new Error("network must not run");
    });
    const before = readFileSync(w.paths.gatewayConfigFile, "utf8");
    for (const [target, level, reason] of [
      ["backend:model", "turbo", "effort"],
      ["claude-haiku-5-5", "high", "Claude"],
      ["backend:other", "high", "chain"],
    ] as const)
      await expect(runGateway(["effort", "scout", target, level], w.ctx)).rejects.toThrow(reason);
    expect(readFileSync(w.paths.gatewayConfigFile, "utf8")).toBe(before);
  });

  it("chain changes, fallback and breaker output show pins, and dropped pins are announced", async () => {
    const w = world(async () => Response.json({ content: [] }));
    await runGateway(["effort", "scout", "backend:model", "high"], w.ctx);
    w.lines.length = 0;
    await runGateway(["fallback", "scout", "off"], w.ctx);
    await runGateway(["breaker", "scout", "off"], w.ctx);
    expect(w.lines.filter((line) => line.includes("backend:model [effort high]"))).toHaveLength(2);
    w.lines.length = 0;
    await runGateway(["slot", "scout", "claude"], w.ctx);
    expect(w.lines.join("\n")).toContain("backend:model [effort high]");
    w.lines.length = 0;
    await runGateway(["slot", "scout", "claude-haiku-5-5"], w.ctx);
    expect(w.lines.join("\n")).toContain("backend:model: effort high removed");
  });

  it("a 200 carrying an upstream error is not acceptance", async () => {
    const w = world(async () => Response.json({ error: { message: "level refused" } }));
    await expect(runGateway(["effort", "scout", "backend:model", "xhigh"], w.ctx)).rejects.toThrow(
      "level refused",
    );
    expect(loadConfigFile(w.paths.gatewayConfigFile).effort).toBeUndefined();
  });

  it("a judge effort is accepted only when that effort still blocks the safety test", async () => {
    const w = world(async () =>
      Response.json({ content: [{ type: "text", text: "<block>no</block>" }] }),
    );
    const before = loadConfigFile(w.paths.gatewayConfigFile);
    saveConfig(w.paths.gatewayConfigFile, {
      ...before,
      slots: { "cc-smart-dev-kit-judge": ["backend:model"] },
    });
    await expect(runGateway(["effort", "judge", "backend:model", "xhigh"], w.ctx)).rejects.toThrow(
      "did not block",
    );
    expect(loadConfigFile(w.paths.gatewayConfigFile).effort).toBeUndefined();
  });

  it("removing a judge pin tests the default effort and refuses an allowing answer", async () => {
    const calls: string[] = [];
    const w = world(async (_url, init) => {
      calls.push(String(init?.body));
      return Response.json({ content: [{ type: "text", text: "<block>no</block>" }] });
    });
    const before = loadConfigFile(w.paths.gatewayConfigFile);
    saveConfig(w.paths.gatewayConfigFile, {
      ...before,
      slots: { "cc-smart-dev-kit-judge": ["backend:model"] },
      effort: { "cc-smart-dev-kit-judge": { "backend:model": "high" } },
    });
    await expect(runGateway(["effort", "judge", "backend:model", "off"], w.ctx)).rejects.toThrow(
      "did not block",
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0] ?? "{}").output_config).toEqual({ effort: "none" });
    expect(loadConfigFile(w.paths.gatewayConfigFile).effort).toEqual({
      "cc-smart-dev-kit-judge": { "backend:model": "high" },
    });
  });

  it("does not save a tested pin when the backend or chain changed during the request", async () => {
    let w: ReturnType<typeof world>;
    w = world(async () => {
      const now = loadConfigFile(w.paths.gatewayConfigFile);
      saveConfig(w.paths.gatewayConfigFile, {
        ...now,
        backends: { backend: { apiKey: "new-secret", baseUrl: "http://new.test" } },
      });
      return Response.json({ content: [] });
    });
    await expect(runGateway(["effort", "scout", "backend:model", "xhigh"], w.ctx)).rejects.toThrow(
      "changed",
    );
    expect(loadConfigFile(w.paths.gatewayConfigFile).effort).toBeUndefined();
  });
});
