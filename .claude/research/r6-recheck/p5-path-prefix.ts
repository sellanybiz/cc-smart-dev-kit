/**
 * P5 — a path in `ANTHROPIC_BASE_URL` is kept on every request, every turn.
 *
 * Two sessions, two turns each (one `claude -p --input-format stream-json`):
 * - the shell exports `<fake A>/r6/prefix-shell`;
 * - the project's settings.local.json names `<fake B>/p/r6-proof` (the gateway's profile form),
 *   while the shell exports fake D with no path.
 * The log shows every path each fake got.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p5-path-prefix.ts`
 */
import { join } from "node:path";
import {
  baseEnv,
  claudeVersion,
  gitRepo,
  makeWorld,
  report,
  StreamSession,
  startFakes,
  trust,
  urlSettings,
  writeJson,
} from "./lib.ts";

const world = makeWorld("p5");
const fakes = startFakes(["A", "B", "D"]);
const sessions = [];
try {
  // 1: the prefix from the shell.
  const shellDir = await gitRepo(world, join(world.root, "proj-shell"));
  await trust(world, shellDir);
  let from = fakes.log.length;
  const one = new StreamSession();
  one.start(shellDir, baseEnv(world, fakes.url("A", "/r6/prefix-shell")));
  const oneTurns = [await one.turn("Say ok"), await one.turn("Say ok again")];
  const oneExit = await one.close();
  sessions.push({
    session: "prefix from the shell",
    turns: oneTurns.map((t) => t?.result),
    exitCode: oneExit,
    requests: fakes.log.slice(from).map((e) => `${e.label} ${e.method} ${e.path}`),
  });

  // 2: the profile form from the project's local file.
  const localDir = await gitRepo(world, join(world.root, "proj-local"));
  await trust(world, localDir);
  writeJson(
    join(localDir, ".claude", "settings.local.json"),
    urlSettings(fakes.url("B", "/p/r6-proof")),
  );
  from = fakes.log.length;
  const two = new StreamSession();
  two.start(localDir, baseEnv(world, fakes.url("D")));
  const twoTurns = [await two.turn("Say ok"), await two.turn("Say ok again")];
  const twoExit = await two.close();
  sessions.push({
    session: "profile prefix from the project's local file",
    turns: twoTurns.map((t) => t?.result),
    exitCode: twoExit,
    requests: fakes.log.slice(from).map((e) => `${e.label} ${e.method} ${e.path}`),
  });
} finally {
  fakes.stop();
}
report(world, { proof: "P5", claude: await claudeVersion(), sessions }, fakes.log);
