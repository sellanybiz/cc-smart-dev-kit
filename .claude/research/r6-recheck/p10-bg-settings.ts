/**
 * P10 — does `claude --bg --settings <file>` carry the file into the background session? The
 * lead runs this; a crew session may not (`bgMode`).
 *
 * A throwaway config, a trusted git repo with no settings of its own, the shell naming D.
 * 1. `--settings` naming C with an `apiKeyHelper` (the fake key), no key in the caller's
 *    environment. Expected (GP0): `backgrounded · <id>`; its `HEAD /api/hello`, its model
 *    request and its small background calls all reach C, none D; `claude logs` shows `ok (C)`.
 * 2. `--settings` naming C, no helper, the fake key in the caller's environment. Expected
 *    (GP0): the session is "Not logged in"; no message request.
 * 3. `--settings` naming C with `ANTHROPIC_API_KEY` in its `env`, no helper. Expected (GP0):
 *    "Not logged in" too.
 * 4. Case 1 in a never-trusted folder. Expected (GP0): exit 1, `Workspace not trusted. …`.
 * Each started session gets `claude logs`, `stop` and `rm`; every process left with this
 * config is ended at the end.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p10-bg-settings.ts [--dry-run]`
 */
import { join } from "node:path";
import {
  baseEnv,
  bgEnd,
  bgMode,
  bgStart,
  claudeVersion,
  endLeftovers,
  FAKE_KEY,
  type Fakes,
  gitRepo,
  helloTo,
  makeWorld,
  messagesTo,
  report,
  startFakes,
  trust,
  type World,
  waitFor,
  writeJson,
} from "./lib.ts";

type Case = {
  name: string;
  settings: Record<string, unknown>;
  keyInCallerEnv: boolean;
  trusted: boolean;
  expect: string;
};

const mode = bgMode();
const world = makeWorld("p10");
const fakes = startFakes(["C", "D"]);

function cases(f: Fakes): Case[] {
  const url = { ANTHROPIC_BASE_URL: f.url("C") };
  return [
    {
      name: "1 --settings URL + apiKeyHelper",
      settings: { env: url, apiKeyHelper: `echo ${FAKE_KEY}` },
      keyInCallerEnv: false,
      trusted: true,
      expect: "every request to C, none to D; logs show ok (C)",
    },
    {
      name: "2 --settings URL, key in the caller's environment",
      settings: { env: url },
      keyInCallerEnv: true,
      trusted: true,
      expect: "Not logged in; no message request",
    },
    {
      name: "3 --settings URL + ANTHROPIC_API_KEY in its env",
      settings: { env: { ...url, ANTHROPIC_API_KEY: FAKE_KEY } },
      keyInCallerEnv: false,
      trusted: true,
      expect: "Not logged in; no message request",
    },
    {
      name: "4 case 1, never-trusted folder",
      settings: { env: url, apiKeyHelper: `echo ${FAKE_KEY}` },
      keyInCallerEnv: false,
      trusted: false,
      expect: "exit 1, Workspace not trusted",
    },
  ];
}

async function runCase(w: World, f: Fakes, index: number, c: Case) {
  const dir = await gitRepo(w, join(w.root, `proj-${index + 1}`));
  if (c.trusted) await trust(w, dir);
  const file = join(w.root, `settings-${index + 1}.json`);
  writeJson(file, c.settings);
  const env = baseEnv(w, f.url("D"));
  if (!c.keyInCallerEnv) delete env.ANTHROPIC_API_KEY;
  const from = f.log.length;
  const start = await bgStart(mode, dir, env, [
    "--settings",
    file,
    "--model",
    "haiku",
    "--strict-mcp-config",
    "--",
    "Say ok",
  ]);
  if (mode === "run" && start.id) {
    await waitFor(() => messagesTo(f.log, from).length > 0, 60_000, 500);
    await Bun.sleep(5000);
  }
  const row: Record<string, unknown> = {
    case: c.name,
    expect: c.expect,
    command: start.command,
    exitCode: start.exitCode,
    stdout: start.stdout.trim(),
    stderr: start.stderr.trim(),
    helloTo: helloTo(f.log, from).join(","),
    messagesTo: messagesTo(f.log, from).join(","),
    models: f.log
      .slice(from)
      .filter((e) => e.model)
      .map((e) => `${e.label} ${e.model}`),
  };
  if (mode === "run" && start.id) row.end = await bgEnd(dir, env, start.id);
  return row;
}

const result: Record<string, unknown> = { proof: "P10", claude: await claudeVersion(), mode };
try {
  const rows = [];
  for (const [index, c] of cases(fakes).entries()) rows.push(await runCase(world, fakes, index, c));
  result.rows = rows;
} finally {
  fakes.stop();
  if (mode === "run") result.leftoversEnded = endLeftovers(world);
}
report(world, result, fakes.log);
