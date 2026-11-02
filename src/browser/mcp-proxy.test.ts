import { expect, spyOn, test } from "bun:test";
import { proxyMcp } from "./mcp-proxy";

function harness(start: () => Promise<{ ok: true } | { ok: false; why: string }>) {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const sent: Buffer[] = [];
  const received: Buffer[] = [];
  let closed = false;
  const proxy = proxyMcp({
    clientInput: new ReadableStream({
      start(controller) {
        input = controller;
      },
    }),
    clientOutput: {
      write: (bytes) => {
        received.push(Buffer.from(bytes));
      },
    },
    childInput: {
      write: (bytes) => {
        sent.push(Buffer.from(bytes));
      },
      end: () => {
        closed = true;
      },
    },
    childOutput: new ReadableStream({
      start(controller) {
        output = controller;
      },
    }),
    startChrome: start,
  });
  return {
    proxy,
    sent,
    received,
    input,
    output,
    closed: () => closed,
    send: (text: string) => input.enqueue(Buffer.from(text)),
    finish: async () => {
      input.close();
      output.close();
      await proxy.done;
    },
  };
}
const call = (id: number) => `{"jsonrpc":"2.0","id":${id},"method":"tools/call"}\n`;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("handshake passes byte for byte without Chrome; first call starts it once", async () => {
  let starts = 0;
  const h = harness(async () => {
    starts++;
    return { ok: true };
  });
  const hello =
    '{ "id":1,"method":"initialize"}\n{"method":"notifications/initialized"}\n{"id":2,"method":"tools/list"}\n';
  h.send(hello);
  await turn();
  expect(Buffer.concat(h.sent).toString()).toBe(hello);
  expect(starts).toBe(0);
  h.send(call(3));
  h.send(call(4));
  await turn();
  expect(starts).toBe(1);
  expect(Buffer.concat(h.sent).toString()).toBe(hello + call(3) + call(4));
  await h.finish();
  expect(h.closed()).toBe(true);
});

test("held lines stay ordered, child messages pass during start, EOF waits for flush", async () => {
  const started = Promise.withResolvers<{ ok: true }>();
  const h = harness(() => started.promise);
  h.send(call(1));
  h.send('{"method":"notifications/cancelled"}\n');
  h.send(call(2));
  h.input.close();
  h.output.enqueue(Buffer.from(' {"method":"notice"}\n'));
  await turn();
  expect(h.sent).toHaveLength(0);
  expect(h.closed()).toBe(false);
  expect(Buffer.concat(h.received).toString()).toBe(' {"method":"notice"}\n');
  started.resolve({ ok: true });
  h.output.close();
  await h.proxy.done;
  expect(Buffer.concat(h.sent).toString()).toBe(
    `${call(1)}{"method":"notifications/cancelled"}\n${call(2)}`,
  );
  expect(h.closed()).toBe(true);
});

test("failure answers held calls once; a new call retries", async () => {
  const started = Promise.withResolvers<{ ok: false; why: string }>();
  let starts = 0;
  const h = harness(() => {
    starts++;
    return starts === 1 ? started.promise : Promise.resolve({ ok: true });
  });
  h.send(`${call(1)}{"method":"notice"}\n${call(2)}`);
  await turn();
  started.resolve({ ok: false, why: "Open Google Chrome" });
  await turn();
  expect(starts).toBe(1);
  expect(Buffer.concat(h.sent).toString()).toBe('{"method":"notice"}\n');
  expect(
    Buffer.concat(h.received)
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual(
    [1, 2].map((id) => ({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: "Open Google Chrome" }], isError: true },
    })),
  );
  h.send(call(3));
  await turn();
  expect(starts).toBe(2);
  expect(Buffer.concat(h.sent).toString()).toBe(`{"method":"notice"}\n${call(3)}`);
  await h.finish();
});

test("split UTF-8, large lines, malformed lines and an unterminated tail stay intact", async () => {
  const h = harness(async () => ({ ok: true }));
  const bytes = Buffer.from(`{"value":"é${"x".repeat(5 * 1024 * 1024)}"}\r\nnot json\nlast`);
  h.input.enqueue(bytes.subarray(0, 11));
  h.input.enqueue(bytes.subarray(11, 12));
  h.input.enqueue(bytes.subarray(12));
  await h.finish();
  expect(Buffer.concat(h.sent).equals(bytes)).toBe(true);
});

test("failed batch gets one array and forwards none of its requests or notifications", async () => {
  const started = Promise.withResolvers<{ ok: false; why: string }>();
  const h = harness(() => started.promise);
  h.send(
    '[ {"id":1,"method":"tools/call"}, {"id":3,"method":"tools/list"}, {"method":"notice"} ]\n',
  );
  const other = ' [ { "id":2, "method":"tools/list" } ]\r\n';
  h.send(other);
  await turn();
  started.resolve({ ok: false, why: "No display" });
  await h.finish();
  expect(Buffer.concat(h.sent).toString()).toBe(other);
  expect(JSON.parse(Buffer.concat(h.received).toString())).toEqual([
    {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "No display" }], isError: true },
    },
    { jsonrpc: "2.0", id: 3, error: { code: -32000, message: "No display" } },
  ]);
});

test("a failed mixed batch replies only to calls and forwards client responses", async () => {
  const h = harness(async () => ({ ok: false, why: "No display" }));
  const response = { jsonrpc: "2.0", id: "roots-1", result: { roots: [] } };
  h.send(`${JSON.stringify([{ id: 1, method: "tools/call" }, response, { method: "notice" }])}\n`);
  await h.finish();
  expect(JSON.parse(Buffer.concat(h.received).toString())).toEqual([
    {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "No display" }], isError: true },
    },
  ]);
  expect(h.sent).toHaveLength(1);
  expect(JSON.parse(Buffer.concat(h.sent).toString())).toEqual([response]);
});

test("a local failure never splits a child's partial output line", async () => {
  const started = Promise.withResolvers<{ ok: false; why: string }>();
  const h = harness(() => started.promise);
  h.output.enqueue(Buffer.from('{"method":'));
  h.send(call(1));
  await turn();
  started.resolve({ ok: false, why: "No display" });
  await turn();
  h.output.enqueue(Buffer.from('"notice"}\n'));
  await h.finish();
  const lines = Buffer.concat(h.received).toString().trim().split("\n");
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "No display" }], isError: true },
    },
    { method: "notice" },
  ]);
});

test("proved Chrome forwards later lines without JSON parsing", async () => {
  const h = harness(async () => ({ ok: true }));
  h.send(call(1));
  await turn();
  const parse = spyOn(JSON, "parse");
  try {
    const later = ' {"id":2,"method":"tools/call"}\r\nnot json\n';
    h.send(later);
    await h.finish();
    expect(parse).not.toHaveBeenCalled();
    expect(Buffer.concat(h.sent).toString()).toBe(call(1) + later);
  } finally {
    parse.mockRestore();
  }
});

test("a batch call starts Chrome and the original batch is forwarded", async () => {
  let starts = 0;
  const h = harness(async () => {
    starts++;
    return { ok: true };
  });
  const batch = '[ {"id":1,"method":"tools/list"}, {"id":2,"method":"tools/call"} ]\n';
  h.send(batch);
  await h.finish();
  expect(starts).toBe(1);
  expect(Buffer.concat(h.sent).toString()).toBe(batch);
});
