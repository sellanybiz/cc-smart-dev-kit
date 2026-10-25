/**
 * UA1 live probe: what Claude Code does with the user-away hook, against a fake Anthropic that
 * answers every first request with one tool call and every second one with the tool result's text.
 *
 *   bun probe.ts <worktree> <label>
 *
 * Labels: bash-away, bash-available, push-away, push-available, ask-away, ask-available.
 * Prints one JSON object: what the model saw as the tool result, the state's items, the stderr.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";

const worktree = process.argv[2] ?? "";
const label = process.argv[3] ?? "";
const lib = await import(join(worktree, ".claude/research/r6-recheck/lib.ts"));
const { makeWorld, baseEnv, runClaude, printArgs, git } = lib;

const world = makeWorld(`ua1-${label}`);
const repo = join(world.root, "repo");
mkdirSync(repo, { recursive: true });
await git(world, repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "README.md"), "x\n");
await git(world, repo, "add", ".");
await git(world, repo, "commit", "-q", "-m", "first");
mkdirSync(join(repo, ".claude"), { recursive: true });
writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "{}\n");

const CALLS: Record<string, { name: string; input: unknown }> = {
  bash: { name: "Bash", input: { command: "echo ua1-probe > probe-output.txt", description: "x" } },
  push: { name: "Bash", input: { command: "git push --force origin main", description: "x" } },
  ask: {
    name: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "Which name?",
          header: "Name",
          options: [
            { label: "alpha", description: "first" },
            { label: "beta", description: "second" },
          ],
          multiSelect: false,
        },
      ],
    },
  },
};
const [kind, mode] = label.split("-") as [string, string];
const call = CALLS[kind];
if (call === undefined || (mode !== "away" && mode !== "available")) throw new Error("bad label");

const requests: unknown[] = [];
const sse = (events: [string, unknown][]) =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const head = (model: string) =>
  [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_ua1",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ],
  ] as [string, unknown][];

const server: Server<undefined> = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/api/hello")) return new Response(null, { status: 200 });
    if (url.pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 1 });
    if (!url.pathname.endsWith("/v1/messages")) return new Response("no", { status: 404 });
    const body = (await req.json()) as {
      model: string;
      messages: { role: string; content: unknown }[];
    };
    requests.push(body);
    const last = body.messages.at(-1);
    const blocks = Array.isArray(last?.content) ? (last.content as { type: string }[]) : [];
    const result = blocks.find((block) => block.type === "tool_result") as
      | { content: unknown }
      | undefined;
    if (result === undefined) {
      const text = JSON.stringify(call.input);
      return new Response(
        sse([
          ...head(body.model),
          [
            "content_block_start",
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "toolu_ua1", name: call.name, input: {} },
            },
          ],
          [
            "content_block_delta",
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: text },
            },
          ],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          [
            "message_delta",
            {
              type: "message_delta",
              delta: { stop_reason: "tool_use", stop_sequence: null },
              usage: { output_tokens: 1 },
            },
          ],
          ["message_stop", { type: "message_stop" }],
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    const seen =
      typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    return new Response(
      sse([
        ...head(body.model),
        [
          "content_block_start",
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        ],
        [
          "content_block_delta",
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: `TOOL RESULT: ${seen}` },
          },
        ],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        [
          "message_delta",
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          },
        ],
        ["message_stop", { type: "message_stop" }],
      ]),
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
if (server.port === 20100) throw new Error("took the live router's port");

// The plugin declares a dependency on claude-mem; a throwaway config has none installed, and
// Claude Code then loads the plugin with no hooks. A copy without the dependency loads.
const pluginCopy = join(world.root, "plugin");
cpSync(join(worktree, "plugin"), pluginCopy, { recursive: true });
const manifestFile = join(pluginCopy, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
if (process.env.UA1_KEEP_DEPENDENCIES === undefined) delete manifest.dependencies;
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
const hookLog = join(world.root, "hooks.log");
const env = {
  ...baseEnv(world, `http://127.0.0.1:${server.port}`),
  CC_SMART_DEV_KIT_HOOK_LOG: hookLog,
};
const cli = (...args: string[]) =>
  Bun.spawnSync([process.execPath, join(worktree, "src/entries/cli.ts"), "user", ...args], {
    env: { ...env, HOME: world.home, CLAUDE_CONFIG_DIR: world.configDir },
    cwd: repo,
  });
if (mode === "away") cli("unavailable");

const run = await runClaude({
  cwd: repo,
  env,
  args: printArgs("go", [
    "--plugin-dir",
    pluginCopy,
    "--max-turns",
    "3",
    "--debug-file",
    join(world.root, "debug.log"),
  ]),
  timeoutMs: 90_000,
});
server.stop(true);

const state = (() => {
  try {
    return JSON.parse(
      readFileSync(join(world.configDir, "cc-smart-dev-kit", "user-away", "state.json"), "utf8"),
    );
  } catch {
    return null;
  }
})();
const noteSeen = JSON.stringify(requests).includes("The person is unavailable since");
console.log(
  JSON.stringify(
    {
      label,
      exitCode: run.exitCode,
      stdout: run.stdout.slice(0, 1500),
      stderr: run.stderr.slice(0, 800),
      items: state?.items ?? null,
      noteInModelRequest: noteSeen,
      debug: (await Bun.file(join(world.root, "debug.log")).exists())
        ? (await Bun.file(join(world.root, "debug.log")).text())
            .split("\n")
            .filter((l) => /cc-smart-dev-kit|hooks from|PermissionRequest/i.test(l))
            .slice(0, 14)
            .map((l) => l.slice(0, 220))
        : "no debug log",
      requests: requests.length,
      hookLog: (await Bun.file(hookLog).exists())
        ? (await Bun.file(hookLog).text())
            .split("\n")
            .filter(Boolean)
            .map((l) => {
              const j = JSON.parse(l);
              return `${j.hook} ${j.event} exit=${j.exitCode} ${String(j.stdout).slice(0, 160)}`;
            })
        : "no hook log",
      outputFileWritten: await Bun.file(join(repo, "probe-output.txt")).exists(),
    },
    null,
    2,
  ),
);
