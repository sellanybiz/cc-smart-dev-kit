/**
 * P13 — what a cancelled request looks like at the server.
 *
 * A fake in hold mode: it answers `HEAD /api/hello`, and holds every message request open (the
 * headers of an event stream, never a byte of body), logging Bun's request signal abort and the
 * response stream's cancel.
 * - SIGINT to a `claude -p` (the process alone) as soon as its message request arrives, twice,
 *   and once 1.5 s after it; then once to a `timeout 120` wrapper around it (GP0's run shape).
 * - Escape in an interactive session (a private tmux server) as soon as its prompt's request
 *   arrives; then whether the session is still alive.
 * After each, the probe waits and records every request that came later.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p13-cancel.ts`
 */
import { join } from "node:path";
import {
  approveFakeKey,
  baseEnv,
  claudeVersion,
  type Fakes,
  gitRepo,
  type LogEntry,
  makeWorld,
  printArgs,
  report,
  runClaude,
  startFakes,
  Tmux,
  trust,
  type World,
  waitFor,
} from "./lib.ts";

const AFTER_MS = 6000;

function isMain(e: LogEntry): boolean {
  return e.event === "request" && e.method === "POST" && /\/v1\/messages(\?|$)/.test(e.path ?? "");
}

function timeline(log: LogEntry[], from: number, zero: number): string[] {
  return log
    .slice(from)
    .map(
      (e) =>
        `+${e.t - zero} ms ${e.event}${e.path ? ` ${e.method} ${e.path}` : ""}${e.tools !== undefined ? ` tools=${e.tools}` : ""}${e.bodyBytes ? ` ${e.bodyBytes} B` : ""}${e.reason ? ` (${e.reason})` : ""}`,
    );
}

async function sigint(world: World, fakes: Fakes, dir: string, delayMs: number, wrap?: string[]) {
  const from = fakes.log.length;
  let zero = 0;
  let signalled = 0;
  const run = await runClaude({
    cwd: dir,
    args: printArgs("Say ok"),
    env: baseEnv(world, fakes.url("H")),
    timeoutMs: 90_000,
    ...(wrap ? { wrap } : {}),
    async onStart(proc) {
      await waitFor(() => fakes.log.slice(from).some(isMain), 60_000, 20);
      zero = fakes.log.slice(from).find(isMain)?.t ?? Date.now();
      await Bun.sleep(delayMs);
      signalled = Date.now();
      proc.kill("SIGINT");
    },
  });
  await Bun.sleep(AFTER_MS);
  return {
    exitCode: run.exitCode,
    signal: run.signal,
    stdout: run.stdout.trim(),
    stderr: run.stderr.trim(),
    signalAt: `+${signalled - zero} ms`,
    timeline: timeline(fakes.log, from, zero),
    postsAfterSignal: fakes.log.slice(from).filter((e) => isMain(e) && e.t > signalled).length,
  };
}

async function escapeKey(world: World, fakes: Fakes, dir: string) {
  const tmux = new Tmux("p13-escape");
  await tmux.start(dir, baseEnv(world, fakes.url("H")), [
    "--model",
    "haiku",
    "--strict-mcp-config",
  ]);
  try {
    await Bun.sleep(5000);
    const from = fakes.log.length;
    await tmux.type("Say ok");
    await waitFor(
      () => fakes.log.slice(from).some((e) => isMain(e) && (e.tools ?? 0) > 0),
      30_000,
      20,
    );
    const main = fakes.log.slice(from).find((e) => isMain(e) && (e.tools ?? 0) > 0);
    const zero = main?.t ?? Date.now();
    await tmux.keys("Escape");
    const pressed = Date.now();
    await Bun.sleep(AFTER_MS);
    return {
      escapeAt: `+${pressed - zero} ms`,
      timeline: timeline(fakes.log, from, zero),
      sessionAlive: await tmux.alive(),
      pane: (await tmux.capture()).trim(),
      postsAfterEscape: fakes.log.slice(from).filter((e) => isMain(e) && e.t > pressed).length,
    };
  } finally {
    await tmux.kill();
  }
}

const world = makeWorld("p13");
await approveFakeKey(world);
const fakes = startFakes(["H"], { hold: true });
const result: Record<string, unknown> = { proof: "P13", claude: await claudeVersion() };
try {
  const dir = await gitRepo(world, join(world.root, "proj"));
  await trust(world, dir);
  result.sigintFirst = await sigint(world, fakes, dir, 0);
  result.sigintSecond = await sigint(world, fakes, dir, 0);
  result.sigintAfterOneAndAHalfSeconds = await sigint(world, fakes, dir, 1500);
  // GP0's run shape wrapped claude in `timeout 120`; the signal here goes to that wrapper.
  result.sigintToATimeoutWrapper = await sigint(world, fakes, dir, 0, ["timeout", "120"]);
  result.escape = await escapeKey(world, fakes, dir);
} finally {
  fakes.stop();
}
report(world, result, fakes.log);
