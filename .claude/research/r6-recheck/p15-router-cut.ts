/**
 * P15 — the router's mid-stream idle limit, end to end (SC1).
 *
 * The real router (`src/entries/router.ts`, run by Bun from a throwaway HOME, on a free port of
 * its own — never the live router's) in front of a fake backend that, for its FIRST streaming
 * request, sends the start of a good answer and then goes silent; every later request gets a
 * whole answer. A `claude -p` run against the router shows whether the router's cut (a body
 * that fails) reaches Claude Code as a torn connection through the router's own server, and
 * whether Claude Code then sends the request again.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p15-router-cut.ts`
 */
import { join } from "node:path";
import {
  approveFakeKey,
  baseEnv,
  claudeVersion,
  gitRepo,
  LIVE_ROUTER_PORT,
  makeWorld,
  printArgs,
  report,
  runClaude,
  trust,
  waitFor,
  writeJson,
} from "./lib.ts";

const IDLE_MS = 3000;

const frame = (name: string, data: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const start = (model: string): string =>
  frame("message_start", {
    type: "message_start",
    message: {
      id: "msg_p15",
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
    delta: { type: "text_delta", text: "ok" },
  });

const end =
  frame("content_block_stop", { type: "content_block_stop", index: 0 }) +
  frame("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 2 },
  }) +
  frame("message_stop", { type: "message_stop" });

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined || port === LIVE_ROUTER_PORT) throw new Error("no free port");
  return port;
}

const world = makeWorld("p15");
await approveFakeKey(world);
const t0 = Date.now();
const events: string[] = [];
const mark = (what: string) => events.push(`+${Date.now() - t0} ms ${what}`);
let streams = 0;
const backend = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/v1/messages") || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    const body = (await req.json()) as { stream?: boolean; model?: string };
    const model = body.model ?? "fake-model";
    if (body.stream !== true) {
      mark("backend: non-streaming request");
      return Response.json({
        id: "msg_p15",
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
    const number = streams;
    mark(`backend: streaming request ${number}`);
    const headers = { "content-type": "text/event-stream" };
    if (number > 1) return new Response(start(model) + end, { headers });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(start(model)));
          // Nothing more: the router must end this one.
        },
        cancel() {
          mark("backend: the router closed the stalled stream");
        },
      }),
      { headers },
    );
  },
});

const routerPort = await freePort();
writeJson(join(world.home, ".config", "cc-smart-dev-kit", "gateway.json"), {
  version: 1,
  port: routerPort,
  backends: {
    omniroute: {
      baseUrl: `http://127.0.0.1:${backend.port}`,
      apiKey: "p15-fake-backend-key-000000",
    },
  },
  slots: { "cc-smart-dev-kit-scout": ["omniroute:fake-model"] },
  timeouts: { firstByteMs: 5000, streamIdleMs: IDLE_MS },
});
await Bun.spawn(["chmod", "600", join(world.home, ".config", "cc-smart-dev-kit", "gateway.json")])
  .exited;

const routerLog: string[] = [];
const router = Bun.spawn(["bun", join(import.meta.dir, "../../../src/entries/router.ts")], {
  env: { PATH: process.env.PATH ?? "", HOME: world.home },
  stdout: "pipe",
  stderr: "pipe",
});
for (const stream of [router.stdout, router.stderr]) {
  void (async () => {
    for await (const chunk of stream) routerLog.push(new TextDecoder().decode(chunk).trim());
  })();
}

const result: Record<string, unknown> = { proof: "P15", claude: await claudeVersion() };
try {
  await waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${routerPort}/__cc-smart-dev-kit/health`)).ok;
      } catch {
        return false;
      }
    },
    20_000,
    100,
  );
  const dir = await gitRepo(world, join(world.root, "proj"));
  await trust(world, dir);
  const run = await runClaude({
    cwd: dir,
    args: printArgs("Say ok"),
    env: baseEnv(world, `http://127.0.0.1:${routerPort}`),
    timeoutMs: 120_000,
  });
  const health = await (
    await fetch(`http://127.0.0.1:${routerPort}/__cc-smart-dev-kit/health`)
  ).json();
  Object.assign(result, {
    idleMs: IDLE_MS,
    exitCode: run.exitCode,
    ms: run.ms,
    stdout: run.stdout.trim().slice(0, 300),
    stderr: run.stderr.trim().slice(0, 300),
    backendStreams: streams,
    events,
    cooling: (health as { cooling?: unknown }).cooling,
    routerLog: routerLog
      .join("\n")
      .split("\n")
      .filter((l) => /WARN|no byte/.test(l)),
  });
} finally {
  router.kill();
  backend.stop(true);
}
report(world, result, []);
