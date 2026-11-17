import { expect, test } from "bun:test";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { z } from "zod";
import { hookEnv } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { createTaskServer, TASK_SERVER_INSTRUCTIONS } from "./mcp";

const resultSchema = z.object({ result: z.unknown() });
async function connectKit(cwd: string) {
  const kit = createTaskServer({
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => null,
    env: hookEnv(),
  });
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
  return { kit, client, request };
}

test("SDK transport initializes, lists nine annotated tools and runs work", async () => {
  const cwd = tempDir();
  const { kit, client, request } = await connectKit(cwd);
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
      "task_take",
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
    expect(
      await request("tools/call", {
        name: "task_update",
        arguments: {
          task: "#1",
          agent: "builder-t",
          branch: "phase-t",
          worktree: "/tmp/phase-t",
          base: "abc123",
        },
      }),
    ).toEqual({ content: [{ type: "text", text: '#1 "Read the result" · pending' }] });
    const got = z
      .object({ content: z.array(z.object({ text: z.string() })) })
      .parse(await request("tools/call", { name: "task_get", arguments: { task: "#1" } }));
    expect(got.content[0]?.text).toContain(
      "Agent: builder-t\nBranch: phase-t\nWorktree: /tmp/phase-t\nBase: abc123",
    );
    expect(
      await request("tools/call", {
        name: "task_create",
        arguments: {
          subject: "Bound",
          agent: "builder-b",
          branch: "phase-b",
          worktree: "/tmp/phase-b",
          base: "def456",
        },
      }),
    ).toEqual({ content: [{ type: "text", text: '#2 "Bound"' }] });
    const bound = z
      .object({ content: z.array(z.object({ text: z.string() })) })
      .parse(await request("tools/call", { name: "task_get", arguments: { task: "#2" } }));
    expect(bound.content[0]?.text).toContain(
      "Agent: builder-b\nBranch: phase-b\nWorktree: /tmp/phase-b\nBase: def456",
    );
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

test("the server refuses to drop a blocking deploy task, and says who can", async () => {
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  const { kit, client, request } = await connectKit(cwd);
  const textOf = (result: unknown) =>
    z.object({ content: z.array(z.object({ text: z.string() })) }).parse(result).content[0]?.text ??
    "";
  try {
    await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const created = textOf(
      await request("tools/call", {
        name: "task_create",
        arguments: { subject: "Gate", kind: "prod", deploy: "before", type: "blocking" },
      }),
    );
    const id = created.split(" ")[0] ?? "";
    expect(id).toMatch(/^prod-\d{8}-\d{6}$/);
    const dropped = await request("tools/call", {
      name: "task_done",
      arguments: { task: id, outcome: "dropped", note: "no longer owed" },
    });
    expect(dropped).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: `${id} is blocking: only the person drops a blocking deploy task. Ask the person to run \`cc-smart-dev-kit task drop ${id} --note "<reason>"\` in their own terminal, outside Claude Code`,
        },
      ],
    });
    expect(
      textOf(
        await request("tools/call", { name: "task_done", arguments: { task: id, evidence: "ok" } }),
      ),
    ).toBe(`${id} "Gate" · done`);
  } finally {
    await kit.close();
    await client.close();
  }
});

test("the server refuses to weaken or delete a blocking deploy task too", async () => {
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  const { kit, client, request } = await connectKit(cwd);
  const textOf = (result: unknown) =>
    z.object({ content: z.array(z.object({ text: z.string() })) }).parse(result).content[0]?.text ??
    "";
  try {
    await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const id =
      textOf(
        await request("tools/call", {
          name: "task_create",
          arguments: { subject: "Gate", kind: "prod", deploy: "before", type: "blocking" },
        }),
      ).split(" ")[0] ?? "";
    const refused = (action: string, command: string) => ({
      isError: true,
      content: [
        {
          type: "text",
          text: `${id} is blocking: only the person ${action}. Ask the person to run \`cc-smart-dev-kit task ${command}\` in their own terminal, outside Claude Code`,
        },
      ],
    });
    expect(
      await request("tools/call", {
        name: "task_update",
        arguments: { task: id, type: "non-blocking" },
      }),
    ).toEqual(refused("weakens a blocking deploy task", `set ${id} --type non-blocking`));
    expect(
      await request("tools/call", {
        name: "task_update",
        arguments: { task: id, deploy: "after" },
      }),
    ).toEqual(refused("weakens a blocking deploy task", `set ${id} --deploy after`));
    expect(await request("tools/call", { name: "task_delete", arguments: { task: id } })).toEqual(
      refused("deletes a blocking deploy task", `delete ${id}`),
    );
  } finally {
    await kit.close();
    await client.close();
  }
});

test("the server's instructions name deploy tasks, never project tasks", () => {
  expect(TASK_SERVER_INSTRUCTIONS).toContain(
    "A step owed before or after a deploy to prod or staging is a deploy task",
  );
  expect(TASK_SERVER_INSTRUCTIONS).toContain("/cc-smart-dev-kit:tasks");
  expect(TASK_SERVER_INSTRUCTIONS).not.toContain("project task");
  expect(TASK_SERVER_INSTRUCTIONS).not.toContain("teammate");
});
