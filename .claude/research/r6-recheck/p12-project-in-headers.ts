/**
 * P12 — does any request header name the project?
 *
 * One `claude -p` in a trusted git repo whose folder has a unique name, against a fake that
 * logs every header and says where that name appears: in a header's value, or in which
 * top-level field of the body (and which item of an array field).
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p12-project-in-headers.ts`
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  baseEnv,
  claudeVersion,
  gitRepo,
  makeWorld,
  printArgs,
  report,
  runClaude,
  startFakes,
  trust,
} from "./lib.ts";

const marker = `r6proj-${randomBytes(4).toString("hex")}`;
const world = makeWorld("p12");
const fakes = startFakes(["A"], { marker });
let run: Awaited<ReturnType<typeof runClaude>>;
try {
  const dir = await gitRepo(world, join(world.root, marker));
  await trust(world, dir);
  run = await runClaude({
    cwd: dir,
    args: printArgs("Say ok"),
    env: baseEnv(world, fakes.url("A")),
    timeoutMs: 90_000,
  });
} finally {
  fakes.stop();
}
const requests = fakes.log.map((e) => ({
  request: `${e.method} ${e.path}`,
  headerNames: Object.keys(e.headers ?? {}).sort(),
  markerInHeaders: (e.markerIn ?? []).filter((p) => p.startsWith("header:")),
  markerInBody: (e.markerIn ?? []).filter((p) => p.startsWith("body:")),
  metadataKeys: e.metadataKeys ?? [],
}));
report(
  world,
  {
    proof: "P12",
    claude: await claudeVersion(),
    marker,
    exitCode: run.exitCode,
    stdout: run.stdout.trim(),
    requests,
    anyHeaderNamesTheProject: requests.some((r) => r.markerInHeaders.length > 0),
  },
  fakes.log,
);
