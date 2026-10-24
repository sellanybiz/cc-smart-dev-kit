/**
 * P9 — does the status line command see the session's effective `ANTHROPIC_BASE_URL`?
 *
 * Interactive sessions in a private tmux server, in a trusted git repo, the shell exporting D.
 * The user file's status line writes its stdin and its environment to files. Two sessions:
 * - the URL from a `--settings` file (S);
 * - the URL from the project's settings.local.json (L).
 * Each session gets one prompt, so the status line runs after a turn too; the last dump counts.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p9-statusline-env.ts`
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveFakeKey,
  baseEnv,
  claudeVersion,
  type Fakes,
  gitRepo,
  makeWorld,
  messagesTo,
  placeSettings,
  report,
  startFakes,
  Tmux,
  trust,
  type World,
  waitFor,
  writeJson,
} from "./lib.ts";

const SHOWN = ["ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR", "PWD", "ANTHROPIC_API_KEY"];

function readEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
}

async function session(world: World, fakes: Fakes, name: string, from: "settings" | "local") {
  const dir = await gitRepo(world, join(world.root, `proj-${name}`));
  await trust(world, dir);
  const dump = join(world.root, `dump-${name}`);
  mkdirSync(dump, { recursive: true });
  const envFile = join(dump, "env.txt");
  writeJson(join(world.configDir, "settings.json"), {
    statusLine: {
      type: "command",
      command: `cat > '${join(dump, "stdin.json")}'; env > '${envFile}'; echo r6-statusline`,
    },
  });
  const args = [
    "--model",
    "haiku",
    "--strict-mcp-config",
    "--debug-file",
    join(world.root, `debug-${name}.txt`),
  ];
  if (from === "settings") {
    const flagFile = join(world.root, `flag-${name}.json`);
    placeSettings(fakes, flagFile, "S");
    args.push("--settings", flagFile);
  } else {
    placeSettings(fakes, join(dir, ".claude", "settings.local.json"), "L");
  }
  const tmux = new Tmux(`p9-${name}`);
  await tmux.start(dir, baseEnv(world, fakes.url("D")), args);
  try {
    const ranAtStart = await waitFor(() => existsSync(envFile), 30_000, 250);
    const atStart = ranAtStart ? readEnv(envFile) : {};
    const sent = fakes.log.length;
    await tmux.type("Say ok");
    await waitFor(() => messagesTo(fakes.log, sent).length > 0, 30_000, 250);
    await Bun.sleep(3000);
    const atEnd = existsSync(envFile) ? readEnv(envFile) : {};
    const pick = (env: Record<string, string>) =>
      Object.fromEntries(
        SHOWN.map((k) => [
          k,
          k === "ANTHROPIC_API_KEY" ? (k in env ? "<present>" : "<absent>") : env[k],
        ]),
      );
    let stdinKeys: string[] = [];
    try {
      stdinKeys = Object.keys(JSON.parse(readFileSync(join(dump, "stdin.json"), "utf8")));
    } catch {
      stdinKeys = ["<unreadable>"];
    }
    return {
      session: name,
      urlFrom: from,
      expected: fakes.url(from === "settings" ? "S" : "L"),
      shell: fakes.url("D"),
      ranAtStart,
      atStart: pick(atStart),
      atEnd: pick(atEnd),
      promptTo: messagesTo(fakes.log, sent).join(","),
      stdinKeys,
      statusLineShown: (await tmux.capture()).includes("r6-statusline"),
      pane: (await tmux.capture()).trim().split("\n").slice(-25).join("\n"),
    };
  } finally {
    await tmux.kill();
  }
}

const world = makeWorld("p9");
await approveFakeKey(world);
const fakes = startFakes(["S", "L", "D"]);
const sessions = [];
try {
  sessions.push(await session(world, fakes, "settings-flag", "settings"));
  sessions.push(await session(world, fakes, "project-local", "local"));
} finally {
  fakes.stop();
}
report(world, { proof: "P9", claude: await claudeVersion(), sessions }, fakes.log);
