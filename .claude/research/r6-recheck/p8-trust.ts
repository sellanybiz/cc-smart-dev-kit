/**
 * P8 — does a project's `env` wait for workspace trust? (`-p` and interactive; the `--bg` half
 * is `p8-bg-trust.ts`, which a crew session may not run.)
 *
 * A fresh throwaway config with no trust record. Fakes: P (a project's settings.json), L (a
 * project's settings.local.json), D (the shell).
 * - `-p`: one run in a never-trusted folder with only the shared file, one with only the local
 *   file; then the same two after a trust record is added.
 * - interactive (a private tmux server): a never-trusted folder with only the local file, and
 *   one with only the shared file. The probe records every request made before the trust
 *   dialog is answered, accepts it, sends one prompt, and records where it went.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p8-trust.ts`
 */
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
  printArgs,
  report,
  runClaude,
  startFakes,
  Tmux,
  trust,
  type World,
  waitFor,
} from "./lib.ts";

async function trustRecorded(world: World, folder: string): Promise<boolean> {
  const config = (await Bun.file(join(world.configDir, ".claude.json")).json()) as {
    projects?: Record<string, { hasTrustDialogAccepted?: boolean }>;
  };
  return config.projects?.[folder]?.hasTrustDialogAccepted === true;
}

async function headless(world: World, fakes: Fakes, dir: string) {
  const from = fakes.log.length;
  const run = await runClaude({
    cwd: dir,
    args: printArgs("Say ok"),
    env: baseEnv(world, fakes.url("D")),
    timeoutMs: 90_000,
  });
  return {
    messageTo: messagesTo(fakes.log, from).join(","),
    exitCode: run.exitCode,
    stdout: run.stdout.trim(),
    stderr: run.stderr.trim(),
    mentionsTrust: /trust/i.test(run.stdout + run.stderr),
    trustRecordAfter: await trustRecorded(world, dir),
  };
}

async function interactive(world: World, fakes: Fakes, dir: string, name: string) {
  const tmux = new Tmux(`p8-${name}`);
  const from = fakes.log.length;
  const env = baseEnv(world, fakes.url("D"));
  await tmux.start(dir, env, ["--model", "haiku", "--strict-mcp-config"]);
  try {
    const sawDialog = await waitFor(async () => /trust/i.test(await tmux.capture()), 30_000, 250);
    // Give a session that would send anything before the answer the time to do it.
    await Bun.sleep(3000);
    const dialog = (await tmux.capture()).trim();
    const beforeTrust = fakes.log.slice(from).map((e) => `${e.label} ${e.method} ${e.path}`);
    const trustBeforeAnswer = await trustRecorded(world, dir);
    // The dialog's cursor starts on "No, exit"; "Yes, I trust this folder" is the next line.
    await tmux.keys("Down");
    await Bun.sleep(300);
    await tmux.keys("Enter");
    await Bun.sleep(4000);
    const afterAnswer = (await tmux.capture()).trim();
    const sent = fakes.log.length;
    await tmux.type("Say ok");
    const answered = await waitFor(() => messagesTo(fakes.log, sent).length > 0, 30_000, 250);
    await Bun.sleep(2000);
    return {
      sawDialog,
      dialog,
      beforeTrust,
      trustBeforeAnswer,
      trustAfterAnswer: await trustRecorded(world, dir),
      afterAnswer,
      answered,
      promptTo: messagesTo(fakes.log, sent).join(","),
      allRequests: fakes.log.slice(from).map((e) => `${e.label} ${e.method} ${e.path}`),
      paneAtEnd: (await tmux.capture()).trim(),
    };
  } finally {
    await tmux.kill();
  }
}

const world = makeWorld("p8");
await approveFakeKey(world);
const fakes = startFakes(["P", "L", "D"]);
const result: Record<string, unknown> = { proof: "P8", claude: await claudeVersion() };
try {
  const sharedDir = await gitRepo(world, join(world.root, "untrusted-shared"));
  placeSettings(fakes, join(sharedDir, ".claude", "settings.json"), "P");
  const localDir = await gitRepo(world, join(world.root, "untrusted-local"));
  placeSettings(fakes, join(localDir, ".claude", "settings.local.json"), "L");

  result.printUntrusted = {
    shared: await headless(world, fakes, sharedDir),
    local: await headless(world, fakes, localDir),
  };
  await trust(world, sharedDir);
  await trust(world, localDir);
  result.printTrusted = {
    shared: await headless(world, fakes, sharedDir),
    local: await headless(world, fakes, localDir),
  };

  const iLocal = await gitRepo(world, join(world.root, "interactive-local"));
  placeSettings(fakes, join(iLocal, ".claude", "settings.local.json"), "L");
  const iShared = await gitRepo(world, join(world.root, "interactive-shared"));
  placeSettings(fakes, join(iShared, ".claude", "settings.json"), "P");
  result.interactiveLocal = await interactive(world, fakes, iLocal, "local");
  result.interactiveShared = await interactive(world, fakes, iShared, "shared");
} finally {
  fakes.stop();
}
report(world, result, fakes.log);
