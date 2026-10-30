/**
 * D69 — the two live proofs the release rests on. The lead runs this; a crew session may not
 * (`bgMode`). Every run is offline: a throwaway `HOME` and `CLAUDE_CONFIG_DIR`, a fake Anthropic
 * server on a free local port, a fake key, a throwaway git repo (`../r6-recheck/lib.ts`). It
 * never reads the person's config, sessions or daemon.
 *
 * 1. A worktree made the way `crew start` makes it (`git worktree add -b crew/P1-probe
 *    .claude/worktrees/crew-P1-probe`), `claude --bg -w crew-P1-probe` in it, and one commit
 *    there that is on no remote and not on `main` — a crew session's state when its turn ends.
 * 2. Control: `claude stop`, then `claude rm <id>` while the worktree is there. Expected: refused,
 *    the row stays in `claude agents --json --all`.
 * 3. The kit's own release (`releaseCrewSession`) of a crew record for that session. Expected:
 *    ok; the worktree folder gone; the branch kept with the commit; the row gone from
 *    `claude agents --json --all`; the conversation file still in `<config>/projects/`.
 * 4. The kit's own restore (`restoreReleasedWorktree`), then `claude --bg --resume <session id>`
 *    from the re-made folder. Expected: `backgrounded`; its model request carries the first
 *    prompt's marker, so the conversation came back.
 * Every session started gets `stop` and `rm`; every process left with this config is ended.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/d69-release/p1-release-resume.ts [--dry-run]`
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../../../src/cli/paths.ts";
import { realCrewContext } from "../../../src/crew/context.ts";
import { releaseCrewSession, restoreReleasedWorktree } from "../../../src/crew/release.ts";
import { createCrew, readCrew, writeLead } from "../../../src/crew/store.ts";
import { transcriptFile } from "../../../src/crew/transcript.ts";
import {
  baseEnv,
  bgEnd,
  bgMode,
  bgStart,
  claudeVersion,
  endLeftovers,
  FAKE_KEY,
  git,
  gitRepo,
  makeWorld,
  messagesTo,
  report,
  runClaude,
  startFakes,
  trust,
  waitFor,
  writeJson,
} from "../r6-recheck/lib.ts";

const MARK = "MARK-D69-FIRST-PROMPT";
const NAME = "crew-P1-probe";
const BRANCH = "crew/P1-probe";
const LEAD = "00000000-1111-2222-3333-444444444444";

const mode = bgMode();
const world = makeWorld("d69");
const fakes = startFakes(["A"], { marker: MARK });
const result: Record<string, unknown> = { proof: "D69", claude: await claudeVersion(), mode };

/** The short ids `claude agents --json --all` lists in this world. */
async function listedIds(cwd: string, env: Record<string, string>): Promise<string[]> {
  const run = await runClaude({ cwd, args: ["agents", "--json", "--all"], env, timeoutMs: 30_000 });
  try {
    const rows = JSON.parse(run.stdout) as Array<{ id?: string; sessionId?: string }>;
    return rows.map((row) => row.id ?? row.sessionId ?? "?");
  } catch {
    return [`unreadable: ${run.stdout.trim().slice(0, 200)} ${run.stderr.trim().slice(0, 200)}`];
  }
}

/** The full session id of short id `id`, from agent view. */
async function sessionIdOf(cwd: string, env: Record<string, string>, id: string) {
  const run = await runClaude({ cwd, args: ["agents", "--json", "--all"], env, timeoutMs: 30_000 });
  const rows = JSON.parse(run.stdout) as Array<{ id?: string; sessionId?: string }>;
  return rows.find((row) => row.id === id)?.sessionId;
}

try {
  const repo = await gitRepo(world, join(world.root, "proj"));
  await trust(world, repo);
  const worktree = join(repo, ".claude", "worktrees", NAME);
  await git(world, repo, "worktree", "add", "-q", "-b", BRANCH, worktree, "HEAD");
  const settings = join(world.root, "settings.json");
  writeJson(settings, {
    env: { ANTHROPIC_BASE_URL: fakes.url("A") },
    apiKeyHelper: `echo ${FAKE_KEY}`,
  });
  const env = baseEnv(world);
  delete env.ANTHROPIC_API_KEY;
  const flags = ["--settings", settings, "--model", "haiku", "--strict-mcp-config"];

  // 1. The crew session's start, its turn, and its local-only commit.
  const start = await bgStart(mode, repo, env, ["-w", NAME, ...flags, "--", `Say ok ${MARK}`]);
  result.start = { command: start.command, exitCode: start.exitCode, stdout: start.stdout.trim() };
  if (mode === "run" && start.id !== undefined) {
    const id = start.id;
    await waitFor(() => messagesTo(fakes.log).length > 0, 60_000, 500);
    await Bun.sleep(5000);
    writeFileSync(join(worktree, "work.txt"), "the phase's work\n");
    await git(world, worktree, "add", "work.txt");
    await git(world, worktree, "commit", "-q", "-m", "the phase's work");
    const head = await git(world, worktree, "rev-parse", "HEAD");
    const sessionId = await sessionIdOf(repo, env, id);
    result.session = { id, sessionId, head };

    // 2. Control: Claude Code's own `rm` while the worktree is there.
    const stop = await runClaude({ cwd: repo, args: ["stop", id], env, timeoutMs: 30_000 });
    const rm = await runClaude({ cwd: repo, args: ["rm", id], env, timeoutMs: 30_000 });
    result.control = {
      stop: `${stop.exitCode} ${stop.stdout.trim()} ${stop.stderr.trim()}`.trim(),
      rm: `${rm.exitCode} ${rm.stdout.trim()} ${rm.stderr.trim()}`.trim(),
      listedAfter: await listedIds(repo, env),
      worktreeAfter: existsSync(worktree),
    };

    // 3. The kit's release of a crew record for that session.
    const paths = cliPaths({ HOME: world.home, CLAUDE_CONFIG_DIR: world.configDir });
    const lines: string[] = [];
    const ctx = {
      ...realCrewContext(paths),
      cwd: repo,
      env,
      error: (line: string) => lines.push(line),
      print: (line: string) => lines.push(line),
      which: (command: string) => Bun.which(command, { PATH: env.PATH ?? "" }),
    };
    await writeLead(
      paths.stateDir,
      { cwd: repo, name: "LEAD probe plan", plan: "plan", repo, sessionId: LEAD, tag: "probe" },
      Date.now(),
    );
    const record = await createCrew(
      paths.stateDir,
      {
        base: { ref: "main", sha: await git(world, repo, "rev-parse", "main") },
        baseRef: "main",
        branch: BRANCH,
        effort: "low",
        files: [],
        id: "P1-probe-d69d69",
        kind: "build",
        lastLine: null,
        leadName: "LEAD probe plan",
        leadSessionId: LEAD,
        memoryMb: null,
        model: { named: "haiku", resolved: "haiku", slot: null, tier: null },
        name: "C probe plan P1 probe",
        permissionMode: "auto",
        phase: "P1",
        plan: "plan",
        pr: null,
        questions: [],
        repo,
        reportPath: null,
        sessionId: sessionId ?? null,
        shortId: id,
        slug: "probe",
        state: "done",
        waitsFor: [],
        worktree,
      },
      Date.now(),
    );
    const released = await releaseCrewSession(record, ctx);
    const conversation =
      sessionId === undefined ? null : transcriptFile(paths.projectsDir, worktree, sessionId);
    result.release = {
      result: released,
      lines,
      worktreeAfter: existsSync(worktree),
      branchHead: await git(world, repo, "rev-parse", BRANCH),
      listedAfter: await listedIds(repo, env),
      jobFolderAfter: existsSync(join(world.configDir, "jobs", id)),
      conversation,
      conversationAfter: conversation === null ? null : existsSync(conversation),
    };

    // 4. The kit's restore, then a resume from the re-made folder.
    const restored = await restoreReleasedWorktree(
      readCrew(paths.stateDir, repo, record.id) ?? record,
      ctx,
    );
    const from = fakes.log.length;
    const resume =
      sessionId === undefined
        ? undefined
        : await bgStart(mode, worktree, env, [
            "--resume",
            sessionId,
            ...flags,
            "--",
            "Say ok again",
          ]);
    if (resume?.id !== undefined) {
      await waitFor(() => messagesTo(fakes.log, from).length > 0, 60_000, 500);
      await Bun.sleep(5000);
    }
    const asked = fakes.log.slice(from).filter((entry) => entry.path?.startsWith("/v1/messages"));
    result.resume = {
      restored,
      worktreeBranch: await git(world, worktree, "branch", "--show-current"),
      workFile: existsSync(join(worktree, "work.txt")),
      command: resume?.command,
      exitCode: resume?.exitCode,
      stdout: resume?.stdout.trim(),
      stderr: resume?.stderr.trim(),
      id: resume?.id,
      markerIn: asked.map((entry) => entry.markerIn ?? []),
      transcriptHasMark:
        conversation !== null && existsSync(conversation)
          ? readFileSync(conversation, "utf8").includes(MARK)
          : null,
    };
    if (resume?.id !== undefined) result.resumeEnd = await bgEnd(worktree, env, resume.id);
  }
} finally {
  fakes.stop();
  if (mode === "run") result.leftoversEnded = endLeftovers(world);
}
report(world, result, fakes.log);
