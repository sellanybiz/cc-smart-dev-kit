/**
 * P14 — what Claude Code does with a stream cut after its first byte (SC1).
 *
 * A fake of our own (never the live router's port) answers the FIRST message request of each
 * case with the start of a good stream (`message_start`, a text block, one delta) and then
 * misbehaves; every later request gets a whole good answer. A `claude -p` run against it shows,
 * per cut, whether Claude Code sends the request again, how soon, whether the retry still
 * streams, and what the run prints.
 *
 * The cuts: `drop` (the connection is torn down mid-body), `end` (the body ends cleanly with no
 * `message_stop`), `error-event` (an `event: error` with an `overloaded_error`, then a clean end),
 * `stall` (nothing more is sent: Claude Code's own timeout, `API_TIMEOUT_MS`, is the only end).
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p14-cut-stream.ts [case…]`
 */
import { join } from "node:path";
import {
  approveFakeKey,
  baseEnv,
  claudeVersion,
  gitRepo,
  LIVE_ROUTER_PORT,
  type LogEntry,
  makeWorld,
  printArgs,
  report,
  runClaude,
  trust,
} from "./lib.ts";

const CUTS = ["drop", "end", "error-event", "stall"] as const;
type Cut = (typeof CUTS)[number];

/** Claude Code's own request timeout for the `stall` case, so the probe ends. */
const STALL_TIMEOUT_MS = 20_000;

const frame = (name: string, data: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const startOfAnswer = (model: string): string =>
  frame("message_start", {
    type: "message_start",
    message: {
      id: "msg_p14",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }) +
  frame("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }) +
  frame("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "cut " },
  });

const endOfAnswer =
  frame("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "ok" },
  }) +
  frame("content_block_stop", { type: "content_block_stop", index: 0 }) +
  frame("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 2 },
  }) +
  frame("message_stop", { type: "message_stop" });

type Entry = LogEntry & { note?: string };

function isMain(e: Entry): boolean {
  return e.event === "request" && e.method === "POST" && /\/v1\/messages(\?|$)/.test(e.path ?? "");
}

function startFake(cut: Cut, log: Entry[]) {
  let streams = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const text = req.method === "POST" ? await req.text() : "";
      let body: { model?: string; stream?: boolean; tools?: unknown[] } = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        // Not JSON: logged below with no model.
      }
      const entry: Entry = {
        t: Date.now(),
        label: cut,
        event: "request",
        method: req.method,
        path: url.pathname + url.search,
        bodyBytes: Buffer.byteLength(text),
      };
      if (body.model) entry.model = body.model;
      if (req.method === "POST") entry.stream = body.stream === true;
      if (Array.isArray(body.tools)) entry.tools = body.tools.length;
      log.push(entry);
      if (url.pathname.endsWith("/api/hello")) return new Response(null, { status: 200 });
      if (url.pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 1 });
      if (!url.pathname.endsWith("/v1/messages") || req.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      // Only a streaming request is cut, and only the first one; every other gets a whole
      // good answer (a side request, or the retry).
      const model = body.model ?? "claude-haiku";
      const headers = { "content-type": "text/event-stream" };
      if (body.stream !== true) {
        return Response.json({
          id: "msg_p14",
          type: "message",
          role: "assistant",
          model,
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 2 },
        });
      }
      streams += 1;
      if (streams > 1) return new Response(startOfAnswer(model) + endOfAnswer, { headers });
      const encoder = new TextEncoder();
      const note = (what: string) =>
        log.push({ t: Date.now(), label: cut, event: "client_closed", reason: what });
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(startOfAnswer(model)));
            await Bun.sleep(300);
            if (cut === "drop") {
              note("fake tore the body down");
              controller.error(new Error("p14 drop"));
            } else if (cut === "end") {
              note("fake ended the body with no message_stop");
              controller.close();
            } else if (cut === "error-event") {
              controller.enqueue(
                encoder.encode(
                  frame("error", {
                    type: "error",
                    error: { type: "overloaded_error", message: "p14 cut" },
                  }),
                ),
              );
              note("fake sent an error event, then ended");
              controller.close();
            }
            // `stall`: nothing more, the body stays open.
          },
          cancel(reason) {
            note(`client closed the stalled body: ${String(reason)}`);
          },
        }),
        { headers },
      );
    },
  });
  if (server.port === LIVE_ROUTER_PORT) {
    server.stop(true);
    throw new Error("a fake took the live router's port");
  }
  return server;
}

async function runCut(cut: Cut) {
  const world = makeWorld(`p14-${cut}`);
  await approveFakeKey(world);
  const log: Entry[] = [];
  const server = startFake(cut, log);
  try {
    const dir = await gitRepo(world, join(world.root, "proj"));
    await trust(world, dir);
    const env = baseEnv(world, `http://127.0.0.1:${server.port}`);
    if (cut === "stall") env.API_TIMEOUT_MS = String(STALL_TIMEOUT_MS);
    const run = await runClaude({
      cwd: dir,
      args: printArgs("Say ok"),
      env,
      timeoutMs: 180_000,
    });
    const zero = log.find(isMain)?.t ?? Date.now();
    const timeline = log
      .filter((e) => isMain(e) || e.event === "client_closed")
      .map(
        (e) =>
          `+${e.t - zero} ms ${e.event === "client_closed" ? `(${e.reason})` : `POST ${e.path} stream=${e.stream} tools=${e.tools ?? 0}`}`,
      );
    return {
      cut,
      exitCode: run.exitCode,
      ms: run.ms,
      timedOut: run.timedOut,
      stdout: run.stdout.trim().slice(0, 300),
      stderr: run.stderr.trim().slice(0, 300),
      messageRequests: log.filter(isMain).length,
      timeline,
    };
  } finally {
    server.stop(true);
    console.error(`(world: ${world.root})`);
  }
}

const wanted = process.argv.slice(2);
const cases = wanted.length > 0 ? CUTS.filter((c) => wanted.includes(c)) : [...CUTS];
const world = makeWorld("p14");
const result: Record<string, unknown> = { proof: "P14", claude: await claudeVersion() };
for (const cut of cases) result[cut] = await runCut(cut);
report(world, result, []);
