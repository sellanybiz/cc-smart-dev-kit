import { expect, test } from "bun:test";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { z } from "zod";
import { tempDir } from "../testing/temp";
import { createTaskServer } from "./mcp";

const resultSchema = z.object({ result: z.unknown() });
test("SDK transport initializes, lists eight annotated tools and runs work", async () => {
  const cwd = tempDir();
  const kit = createTaskServer({ stateDir: tempDir(), cwd: () => cwd, caller: () => null });
  const [client, transport] = InMemoryTransport.createLinkedPair();
  let id = 0;
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number") pending.get(message.id)?.(message);
  };
  await client.start();
  await kit.server.connect(transport);
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const current = ++id;
      pending.set(current, (message) => {
        pending.delete(current);
        const parsed = resultSchema.safeParse(message);
        if (parsed.success) resolve(parsed.data.result);
        else reject(new Error(JSON.stringify(message)));
      });
      client.send({ jsonrpc: "2.0", id: current, method, params }).catch(reject);
    });
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(initialized).toMatchObject({ serverInfo: { name: "cc-smart-dev-kit-tasks" } });
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const tools = await request("tools/list");
    const parsed = z
      .object({
        tools: z.array(
          z.object({
            name: z.string(),
            annotations: z.object({ readOnlyHint: z.boolean(), destructiveHint: z.boolean() }),
          }),
        ),
      })
      .parse(tools);
    expect(parsed.tools.map((t) => t.name)).toEqual([
      "task_create",
      "task_update",
      "task_done",
      "task_note",
      "task_list",
      "task_get",
      "task_search",
      "task_delete",
    ]);
    expect(parsed.tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)).toEqual([
      "task_list",
      "task_get",
      "task_search",
    ]);
    expect(parsed.tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual([
      "task_delete",
    ]);
    expect(
      await request("tools/call", {
        name: "task_create",
        arguments: { subject: "Read the result" },
      }),
    ).toEqual({ content: [{ type: "text", text: '#1 "Read the result"' }] });
    expect(await request("tools/call", { name: "task_list", arguments: {} })).toEqual({
      content: [{ type: "text", text: "#1 [pending] Read the result" }],
    });
    expect(await request("tools/call", { name: "task_done", arguments: { task: "#1" } })).toEqual({
      content: [{ type: "text", text: '#1 "Read the result" · done' }],
    });
    expect(await request("tools/call", { name: "task_get", arguments: { task: "#99" } })).toEqual({
      isError: true,
      content: [{ type: "text", text: "Task not found: #99" }],
    });
  } finally {
    await kit.close();
    await client.close();
  }
});
