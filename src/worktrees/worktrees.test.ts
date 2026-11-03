/**
 * `cc-smart-dev-kit worktrees`: which worktrees are finished, and removing them.
 *
 * The scan runs against a real git repo in a temp folder — a bare "origin" and one linked
 * worktree — with the machine's own facts given (no Docker, no processes, no sessions), so
 * nothing here reads the host.
 */
import { describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { cleanGitEnv, git, tempDir, withGitVersion } from "../testing/temp";
import { baseBranch, DEFAULT_BASE, runWorktrees, type WorktreesAnswer } from "./command";
import {
  containersUsing,
  hostPath,
  parseCommandLines,
  parseContainerMounts,
  parsePrograms,
  programsInside,
} from "./machine-facts";
import {
  deleteMergedBranch,
  fetchBase,
  isParkedWorktree,
  parkedOriginal,
  pullRequestMerged,
  removeWorktree,
  replayOntoBase,
  scanWorktrees,
} from "./scan";
import { finishStrays, strayParkedFolders } from "./scan-parked";
import { IDLE_MINUTES, verdict, type WorktreeFacts } from "./verdict";

/** A repo with a bare "origin", one commit on `main`, and one linked worktree. */
function repo(): { main: string; origin: string; worktree: string } {
  const root = tempDir("worktrees");
  const origin = join(root, "origin.git");
  const main = join(root, "app");
  mkdirSync(origin);
  git(origin, "init", "--bare", "--initial-branch=main");
  mkdirSync(main);
  git(main, "init", "--initial-branch=main");
  writeFileSync(join(main, "README.md"), "# app\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "first");
  git(main, "remote", "add", "origin", origin);
  git(main, "push", "-u", "origin", "main");
  git(main, "remote", "set-head", "origin", "--auto");
  const worktree = join(root, "app-wt-fix-login");
  git(main, "worktree", "add", "-b", "fix/login", worktree);
  return { main, origin, worktree };
}

const facts = (over: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  aheadOfBase: 0,
  base: "main",
  containers: [],
  gitTooOld: null,
  idleMinutes: IDLE_MINUTES + 1,
  innerWorktree: null,
  locked: false,
  mergedBy: null,
  parked: false,
  programs: [],
  sessionName: null,
  ...over,
});

const clean = { localFiles: [], uncommitted: false };

/**
 * The environment with a fake `gh` first on PATH: it answers the one call the scan makes
 * (`gh pr list --head <branch> --state merged --json number,headRefOid --limit 1`) with a
 * merged pull request for `branch` whose head is `head`, and refuses every other call, so
 * the argv is checked too.
 */
function withFakeGh(
  env: Record<string, string>,
  branch = "fix/login",
  head = "0000000000000000000000000000000000000000",
): Record<string, string> {
  const dir = tempDir("fake-gh");
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
echo "$*" >> '${join(dir, "gh.log")}'
if [ "$1" != "pr" ] || [ "$2" != "list" ]; then echo "fake gh: unknown call: $*" >&2; exit 1; fi
head=
while [ $# -gt 0 ]; do
  if [ "$1" = "--head" ]; then shift; head="$1"; fi
  shift
done
if [ "$head" != '${branch}' ]; then echo "fake gh: no merged pull request for $head" >&2; exit 1; fi
echo '[{"number":7,"headRefOid":"${head}"}]'
`,
    { mode: 0o755 },
  );
  return { ...env, PATH: `${dir}:${env.PATH ?? ""}` };
}

/** A machine-wide clean lock nobody else holds: the real port is never reached from a test. */
const freeLock = async (): Promise<{ close(): void }> => ({ close: () => undefined });

describe("the verdict on one worktree", () => {
  test("everything clean: finished", () => {
    expect(verdict(facts(), () => clean)).toEqual({ finished: true, note: null });
  });

  test("D62: a folder a removal moved aside asks for neither the base's commits nor the idle hour", () => {
    // Its branch keeps the commits, and the move itself was the removal's own touch.
    expect(
      verdict(facts({ aheadOfBase: 3, idleMinutes: 0, parked: true }), () => clean, IDLE_MINUTES),
    ).toEqual({ finished: true, note: null });
    // Every other reason to keep it stands.
    expect(verdict(facts({ parked: true, programs: ["bun"] }), () => clean)).toMatchObject({
      finished: false,
      why: "a program runs from its files: bun",
    });
    expect(
      verdict(facts({ parked: true }), () => ({ localFiles: [], uncommitted: true })),
    ).toMatchObject({ finished: false, why: "uncommitted changes" });
    // And a worktree that is not parked still waits for both.
    expect(verdict(facts({ aheadOfBase: 3 }), () => clean)).toMatchObject({ finished: false });
    expect(verdict(facts({ idleMinutes: 0 }), () => clean, IDLE_MINUTES)).toMatchObject({
      finished: false,
    });
  });

  test("each reason to keep it, with the words a person reads", () => {
    expect(verdict(facts({ locked: true }), () => clean)).toEqual({
      finished: false,
      held: false,
      why: "locked with `git worktree lock`",
    });
    expect(verdict(facts({ sessionName: "Fix the login bug" }), () => clean)).toEqual({
      finished: false,
      held: true,
      why: 'Claude session "Fix the login bug" works in it',
    });
    expect(verdict(facts({ programs: ["bun"] }), () => clean)).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: bun",
    });
    expect(verdict(facts({ containers: ["db"] }), () => clean)).toEqual({
      finished: false,
      held: true,
      why: 'Docker container "db" uses its files',
    });
    expect(
      verdict(facts({ innerWorktree: "/work/app-wt-x/.claude/worktrees/agent-1" }), () => clean),
    ).toEqual({
      finished: false,
      held: false,
      why: "another worktree lives inside it: /work/app-wt-x/.claude/worktrees/agent-1",
    });
    expect(verdict(facts({ aheadOfBase: 3 }), () => clean)).toEqual({
      finished: false,
      held: false,
      why: "3 commits not on main",
    });
    expect(verdict(facts({ aheadOfBase: 1 }), () => clean)).toEqual({
      finished: false,
      held: false,
      why: "1 commit not on main",
    });
    expect(verdict(facts({ idleMinutes: 5 }), () => clean)).toEqual({
      finished: false,
      held: true,
      why: "git used it 5 min ago",
    });
    expect(verdict(facts(), () => ({ localFiles: [], uncommitted: true }))).toEqual({
      finished: false,
      held: false,
      why: "uncommitted changes",
    });
    expect(
      verdict(facts(), () => ({
        localFiles: [".env.local", "notes.local.md"],
        uncommitted: false,
      })),
    ).toEqual({
      finished: false,
      held: false,
      why: "local files git does not keep: .env.local, notes.local.md",
    });
  });

  test("docker or the processes could not be listed: keep it, and say why", () => {
    expect(verdict(facts({ containers: "unknown" }), () => clean).finished).toBe(false);
    const unknown = verdict(facts({ programs: "unknown" }), () => clean);
    expect(unknown.finished).toBe(false);
    expect(unknown.finished ? "" : unknown.why).toContain(
      "the running programs could not be listed",
    );
  });

  test("`--remove` after a session's own merge: a recent touch keeps nothing (idleLimit 0)", () => {
    expect(verdict(facts({ idleMinutes: 0 }), () => clean, 0)).toEqual({
      finished: true,
      note: null,
    });
  });

  test("the slow `git status` is asked only when everything else already says yes", () => {
    let asked = 0;
    const contents = () => {
      asked += 1;
      return clean;
    };
    verdict(facts({ aheadOfBase: 1 }), contents);
    expect(asked).toBe(0);
    verdict(facts(), contents);
    expect(asked).toBe(1);
  });
});

describe("the machine's facts", () => {
  test("docker's containers, their bind mounts only, and the worktrees they use", () => {
    const inspected = [
      '{"name":"/app-db","mounts":[{"Type":"bind","Source":"/work/app-wt-x/supabase"},{"Type":"volume","Source":"/var/lib/docker/volumes/x"}]}',
      '{"name":"/other","mounts":[]}',
      '{"name":"/above","mounts":[{"Type":"bind","Source":"/work"}]}',
    ].join("\n");
    const containers = parseContainerMounts(inspected);
    expect(containersUsing("/work/app-wt-x", containers ?? [], false)).toEqual(["app-db"]);
    // A mount ABOVE the worktree survives its removal.
    expect(
      containersUsing("/work/app-wt-x", [{ name: "above", sources: ["/work"] }], false),
    ).toEqual([]);
    expect(parseContainerMounts("not json")).toBeNull();
  });

  test("a bind mount's source on Windows, in every form Docker reports it", () => {
    expect(hostPath("D:\\work\\app", true)).toBe("D:\\work\\app");
    expect(hostPath("/d/work/app", true)).toBe("D:/work/app");
    expect(hostPath("/mnt/d/work/app", true)).toBe("D:/work/app");
    expect(hostPath("/run/desktop/mnt/host/d/work/app", true)).toBe("D:/work/app");
    expect(hostPath("/host_mnt/d/work/app", true)).toBe("D:/work/app");
    expect(hostPath("/work/app", false)).toBe("/work/app");
  });

  test("a worktree reached through a symlink: the physical path counts as inside it, both ways", () => {
    const root = tempDir("worktrees-link");
    const real = join(root, "real", "app-wt-x");
    mkdirSync(real, { recursive: true });
    const link = join(root, "link");
    symlinkSync(join(root, "real"), link);
    const linked = join(link, "app-wt-x");
    // `/proc/<pid>/cwd` holds the physical path, while a worktree may be listed through a
    // link (and the other way round: a session started with `cd <link>/…`).
    expect(
      programsInside([{ cwd: real, path: "/usr/bin/bun dev", pid: 3 }], linked, false, 900),
    ).toEqual(["bun"]);
    expect(
      programsInside([{ cwd: linked, path: "/usr/bin/bun dev", pid: 3 }], real, false, 900),
    ).toEqual(["bun"]);
    // A command line written from the physical path counts too.
    expect(programsInside([{ path: `${real}/server.ts`, pid: 4 }], linked, false, 900)).toEqual([
      "server.ts",
    ]);
    expect(containersUsing(linked, [{ name: "db", sources: [real] }], false)).toEqual(["db"]);
    expect(containersUsing(real, [{ name: "db", sources: [linked] }], false)).toEqual(["db"]);
    // A folder that holds none of it stays out.
    expect(containersUsing(linked, [{ name: "x", sources: [root] }], false)).toEqual([]);
  });

  test("the programs using a worktree: started from it, or working in it", () => {
    // `ps -ww -o pid=,ppid=,args=`: the pid, the process that started it, then the command line.
    const lines = [
      `11 9 /usr/bin/bun /work/app-wt-x/server.ts`,
      "12 9 /usr/bin/other --flag /work/app-wt-x/notes.md",
      "13 9 /usr/bin/git status",
      `14 9 node /opt/thing.js --cwd /work/app-wt-y`,
    ].join("\n");
    const programs = parseCommandLines(lines);
    expect(programs).toEqual([
      { parentPid: 9, path: "/usr/bin/bun /work/app-wt-x/server.ts", pid: 11 },
      { parentPid: 9, path: "/usr/bin/other --flag /work/app-wt-x/notes.md", pid: 12 },
      { parentPid: 9, path: "/usr/bin/git status", pid: 13 },
      { parentPid: 9, path: "node /opt/thing.js --cwd /work/app-wt-y", pid: 14 },
    ]);
    expect(programsInside(programs, "/work/app-wt-x", false, 900)).toEqual(["bun", "other"]);
    // A `git` of our own scanning there never keeps a worktree (the scan runs git itself).
    expect(
      programsInside(
        [{ cwd: "/work/app-wt-x", parentPid: 900, path: "/usr/bin/git status", pid: 9 }],
        "/work/app-wt-x",
        false,
        900,
      ),
    ).toEqual([]);
    // A program whose working folder is inside it counts, even when its command line never
    // names it: a dev server started with `cd <worktree>`.
    expect(
      programsInside(
        [{ cwd: "/work/app-wt-x", parentPid: 900, path: "/usr/bin/bun --watch", pid: 9 }],
        "/work/app-wt-x",
        false,
        900,
      ),
    ).toEqual(["bun"]);
    // Windows' list: `<pid><tab><parent pid><tab><file>`.
    expect(parsePrograms("42\t7\tC:\\Program Files\\nodejs\\node.exe")).toEqual([
      { parentPid: 7, path: "C:\\Program Files\\nodejs\\node.exe", pid: 42 },
    ]);
  });

  test("a listing line without a command line is left out, never read as a parent pid", () => {
    // A process `ps` prints with no arguments left has a pid and a parent pid and nothing
    // else: what remains is no file, and taking the parent pid for one would count a program
    // that is not there.
    expect(parseCommandLines("  103  101\n  104  101 /usr/bin/bun dev")).toEqual([
      { parentPid: 101, path: "/usr/bin/bun dev", pid: 104 },
    ]);
    expect(parsePrograms("42\t7\nnot a line")).toEqual([]);
  });

  test("the command that asked about a worktree, and the chain that started it, never count", () => {
    // `cc-smart-dev-kit worktrees --remove /work/app-wt-x` names the folder in its own command
    // line, and so does the shell that ran it, and the session above that. None of them works
    // in it: they only asked about it.
    const asking = [
      { parentPid: 200, path: "bun cli.ts worktrees --remove /work/app-wt-x", pid: 100 },
      {
        parentPid: 300,
        path: "bash -c cc-smart-dev-kit worktrees --remove /work/app-wt-x",
        pid: 200,
      },
      { parentPid: 1, path: "claude", pid: 300 },
    ];
    expect(programsInside(asking, "/work/app-wt-x", false, 100)).toEqual([]);
    // The head is this process unless the caller says otherwise: the same command chain, with
    // the pid the real `worktrees` has.
    expect(
      programsInside(
        [
          {
            parentPid: 200,
            path: "bun cli.ts worktrees --remove /work/app-wt-x",
            pid: process.pid,
          },
          {
            parentPid: 1,
            path: "bash -c cc-smart-dev-kit worktrees --remove /work/app-wt-x",
            pid: 200,
          },
        ],
        "/work/app-wt-x",
        false,
      ),
    ).toEqual([]);
    // An ANCESTOR of ours working in the worktree still counts: the shell that sits there —
    // its command line is no reason to count it, but its working folder is.
    expect(
      programsInside(
        [
          { parentPid: 300, path: "bun cli.ts worktrees --remove /work/app-wt-x", pid: 100 },
          { cwd: "/work/app-wt-x", parentPid: 1, path: "bash -c cd /work/app-wt-x", pid: 300 },
        ],
        "/work/app-wt-x",
        false,
        100,
      ),
    ).toEqual(["bash"]);
    // Only the chain is left out: an unrelated program naming it counts, and so does a CHILD
    // of our own process (started by the command that is asking).
    expect(
      programsInside(
        [
          { parentPid: 1, path: "/usr/bin/node /work/app-wt-x/server.js", pid: 4001 },
          { parentPid: 100, path: "/usr/bin/tail -f /work/app-wt-x/log", pid: 4002 },
        ],
        "/work/app-wt-x",
        false,
        100,
      ),
    ).toEqual(["node", "tail"]);
    // A pid seen twice ends the walk: a reused pid cannot hang it.
    expect(
      programsInside(
        [
          { parentPid: 200, path: "bun /work/app-wt-x/server.js", pid: 100 },
          { parentPid: 100, path: "other /work/app-wt-x/notes.md", pid: 200 },
        ],
        "/work/app-wt-x",
        false,
        100,
      ),
    ).toEqual([]);
  });
});

describe("scanning and removing, against a real repo", () => {
  const env = cleanGitEnv();

  test("a worktree whose every commit is on origin/main is finished, and is removed with its branch", async () => {
    const { main, worktree } = repo();
    const scanOptions = {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      // git wrote the worktree's admin files just now: the one-hour wait is what `--remove`
      // skips, and this is the same test of the rest of the verdict.
      idleLimit: 0,
    };
    const scanned = scanWorktrees(main, scanOptions);
    const linked = scanned.filter((entry) => entry.state !== "main");
    expect(linked).toHaveLength(1);
    expect(linked[0]?.state).toEqual({ finished: true, note: null });
    expect(linked[0]?.listed.branch).toBe("fix/login");

    const listed = linked[0]?.listed;
    if (listed === undefined) throw new Error("the worktree is not listed");
    const removal = removeWorktree(main, listed, scanOptions);
    expect(removal.status).toBe("removed");
    expect(removal.said).toEqual([`removed ${worktree}`, "deleted branch fix/login"]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(main, "branch", "--list", "fix/login")).toBe("");
  });

  test("CM-7: a worktree that changed since the scan is judged again at removal", () => {
    // Between the scan the person read and the removal, the session in that worktree
    // committed: trusting the scan's verdict would delete work that is on no branch of the
    // base — nothing brings those commits back.
    const { main, worktree } = repo();
    const scanOptions = {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    };
    const scanned = scanWorktrees(main, scanOptions);
    const listed = scanned[1]?.listed;
    if (listed === undefined) throw new Error("the worktree is not listed");
    expect(scanned[1]?.state).toEqual({ finished: true, note: null });

    writeFileSync(join(worktree, "late.ts"), "export const late = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "late work");

    const removal = removeWorktree(main, listed, scanOptions);
    expect(removal.status).toBe("kept");
    expect(removal.said).toEqual([`kept ${worktree}: 1 commit not on main`]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(main, "branch", "--list", "fix/login")).toContain("fix/login");
  });

  test("CM-8: a squash merge is finished: merging the branch into the base changes nothing", () => {
    // A squash merge puts ONE commit of its own on the base: the branch's commit is not an
    // ancestor of it, and `git cherry` sees no equivalent of it (the squashed change carries
    // the release notes with it). Merging the branch into the base is what says the work is
    // there: the base already holds it, so the merge gives the base's own tree back.
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the feature");
    writeFileSync(join(main, "feature.ts"), "export const feature = 1;\n");
    writeFileSync(join(main, "CHANGELOG.md"), "- the feature (#7)\n");
    git(main, "add", ".");
    git(main, "commit", "-m", "the feature (#7)");
    git(main, "push", "origin", "main");

    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: true,
      note: "merging it into main changes nothing",
    });
    // The replay itself: merging the branch into the base gives the base's own tree back.
    const head = git(worktree, "rev-parse", "HEAD").trim();
    expect(replayOntoBase(main, "origin/main", head, env)).toBe("nothing");
  });

  test("CM-8: a commit after the squash keeps the worktree: the merge would change the base", () => {
    // The squash merged the first commit; the session then committed again on the branch.
    // That last commit is on no branch of the base, so removing the worktree would lose it.
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the feature");
    writeFileSync(join(main, "feature.ts"), "export const feature = 1;\n");
    git(main, "add", ".");
    git(main, "commit", "-m", "the feature (#7)");
    git(main, "push", "origin", "main");
    writeFileSync(join(worktree, "later.ts"), "export const later = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the later work");

    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "2 commits not on main",
    });
    expect(git(main, "branch", "--list", "fix/login")).toContain("fix/login");
  });

  test("CM-8: a rebase merge is finished too", () => {
    // The work went through a "rebase and merge": the base holds the same change as a commit
    // object of its own (its own committer and date), so the worktree's commit is not an
    // ancestor of it — nothing in it is missing there.
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the feature");
    git(main, "cherry-pick", git(worktree, "rev-parse", "HEAD").trim());
    git(main, "commit", "--amend", "--no-edit", "--date", "2020-01-01T00:00:00");
    git(main, "push", "origin", "main");

    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: true,
      note: "merging it into main changes nothing",
    });
  });

  test("CM-8: a branch and a base that changed the same file differently are kept", () => {
    // The merge of the branch into the base would need a hand, so nothing here can say the
    // work is on the base — and it is not: the two changed the same file in their own way.
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "shared.ts"), "export const fromBranch = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the branch's change");
    writeFileSync(join(main, "shared.ts"), "export const fromBase = 1;\n");
    git(main, "add", ".");
    git(main, "commit", "-m", "the base's change");
    git(main, "push", "origin", "main");

    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "1 commit not on main",
    });
    // The merge of the two would need a hand, so the replay itself cannot say: it is
    // "unknown", never "the base holds the work".
    const head = git(worktree, "rev-parse", "HEAD").trim();
    expect(replayOntoBase(main, "origin/main", head, env)).toBe("unknown");
  });

  test("a squash-merged worktree with a file of its own is kept", () => {
    // The work is on the base, but the folder holds a file that is not in git: removing it
    // would lose that file.
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the feature");
    writeFileSync(join(main, "feature.ts"), "export const feature = 1;\n");
    git(main, "add", ".");
    git(main, "commit", "-m", "the feature (#7)");
    git(main, "push", "origin", "main");
    writeFileSync(join(worktree, "notes.local.md"), "mine\n");

    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "uncommitted changes",
    });
  });

  test("a merged pull request counts only when it merged this head", () => {
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the feature");
    const head = git(worktree, "rev-parse", "HEAD").trim();
    // The pull request merged this exact commit: its work is on the base.
    expect(pullRequestMerged(main, "fix/login", head, withFakeGh(env, "fix/login", head))).toBe(
      true,
    );
    // A pull request that merged an older head says nothing about the commits after it.
    expect(
      pullRequestMerged(main, "fix/login", head, withFakeGh(env, "fix/login", "0".repeat(40))),
    ).toBe(false);
    // No `gh` at all: not known merged, and nothing was asked of the network.
    expect(pullRequestMerged(main, "fix/login", head, { ...env, PATH: tempDir("no-gh") })).toBe(
      false,
    );
  });

  test("a git too old to replay the branch keeps the worktree, and says which git", () => {
    // `git merge-tree --write-tree` came with git 2.38. An older git cannot say whether the
    // work is on the base, so the worktree is kept — and the reason names the git that
    // cannot answer, so the person knows why the pile does not go.
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "the feature");
    writeFileSync(join(main, "feature.ts"), "export const feature = 1;\n");
    writeFileSync(join(main, "CHANGELOG.md"), "- the feature (#7)\n");
    git(main, "add", ".");
    git(main, "commit", "-m", "the feature (#7)");
    git(main, "push", "origin", "main");

    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env: withGitVersion(env, "2.30.0"),
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "1 commit not on main (git 2.30.0 is too old to replay it onto main: git 2.38.0 or newer is needed)",
    });
  });

  test("a worktree holding a submodule says so, with the way out git leaves", () => {
    // `git worktree move` AND `git worktree remove` refuse a worktree that holds a submodule
    // ("working trees containing submodules cannot be moved or removed", checked against this
    // machine's git 2.4x, with the submodule initialized and with one only in the index). So
    // "a program may still work in it — try again" is wrong advice: nothing about it can
    // change by waiting.
    const { main, worktree } = repo();
    const library = join(dirname(main), "lib");
    mkdirSync(library);
    git(library, "init", "--initial-branch=main");
    writeFileSync(join(library, "lib.ts"), "export const lib = 1;\n");
    git(library, "add", ".");
    git(library, "commit", "-m", "the library");
    git(worktree, "-c", "protocol.file.allow=always", "submodule", "add", library, "lib");
    git(worktree, "commit", "-m", "add the library");
    // Its work is on the base: git's own rule about submodules is all that keeps it.
    git(main, "merge", "--ff-only", "fix/login");
    git(main, "push", "origin", "main");

    const scanOptions = {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    };
    const scanned = scanWorktrees(main, scanOptions);
    const listed = scanned[1]?.listed;
    if (listed === undefined) throw new Error("the worktree is not listed");
    expect(scanned[1]?.state).toEqual({ finished: true, note: null });

    const removal = removeWorktree(main, listed, scanOptions);
    expect(removal.status).toBe("kept");
    expect(removal.said).toEqual([
      `kept ${worktree}: it holds a git submodule, and git cannot move or remove such a ` +
        `worktree. Commit and push the work in it, delete the folder by hand, and run ` +
        `\`cc-smart-dev-kit worktrees\` again: a worktree whose folder is gone is forgotten.`,
    ]);
    expect(existsSync(worktree)).toBe(true);
  });

  test("a commit of its own keeps it; so does an uncommitted file", async () => {
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "work");
    const withCommit = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(withCommit[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "1 commit not on main",
    });

    // The commit goes to main; the worktree is clean again, then a file is left in it.
    git(main, "merge", "--ff-only", "fix/login");
    git(main, "push", "origin", "main");
    writeFileSync(join(worktree, "notes.local.md"), "mine\n");
    const withFile = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(withFile[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "uncommitted changes",
    });
    const withFileListed = withFile[1]?.listed;
    if (withFileListed === undefined) throw new Error("the worktree is not listed");
    const removal = removeWorktree(main, withFileListed, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      // The machine's facts are the test's, as in the scan: never this machine's Docker.
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(removal.status).toBe("kept");
    expect(existsSync(worktree)).toBe(true);
  });

  test("a running session in it keeps it, and a program using it keeps it too", async () => {
    const { main, worktree } = repo();
    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: {
        containers: [],
        programs: [],
        sessions: [{ cwd: worktree, name: "Fix the login bug", pid: 1, sessionId: "s" }],
      },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: false,
      held: true,
      why: 'Claude session "Fix the login bug" works in it',
    });

    const held = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: {
        containers: [],
        programs: [{ cwd: worktree, path: "/usr/bin/bun dev", pid: 2 }],
        sessions: [],
      },
      idleLimit: 0,
    });
    expect(held[1]?.state).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: bun",
    });
  });

  test("a worktree whose folder is gone is named, and pruning forgets it", async () => {
    const { main, worktree } = repo();
    // The folder is deleted behind git's back, as a killed session can leave it.
    Bun.spawnSync(["rm", "-rf", worktree]);
    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toBe("gone");
  });

  test("a session that reached the worktree through a symlink keeps it", async () => {
    const { main, worktree } = repo();
    const link = join(dirname(worktree), "app-wt-link");
    symlinkSync(worktree, link);
    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      // Claude Code records the folder the session was started in, which may be the linked
      // one while git lists the physical one.
      facts: {
        containers: [],
        programs: [],
        sessions: [{ cwd: link, name: "Fix the login bug", pid: 1, sessionId: "s" }],
      },
      idleLimit: 0,
    });
    expect(scanned[1]?.state).toEqual({
      finished: false,
      held: true,
      why: 'Claude session "Fix the login bug" works in it',
    });
  });

  test("an unknown base branch is refused, not guessed", () => {
    const { main } = repo();
    expect(() =>
      scanWorktrees(main, {
        base: "trunk",
        claudeConfigDir: tempDir("worktrees-config"),
        env,
        facts: { containers: [], programs: [], sessions: [] },
      }),
    ).toThrow("origin/trunk is not known here");
  });

  test.each([null, "pid:[12345]"])(
    "a nested or unknown pid namespace %s never proves a host locker gone",
    (pidNamespace) => {
      const { main, worktree } = repo();
      const reason = "claude session live-host (pid 424242 start 12345)";
      git(main, "worktree", "lock", "--reason", reason, worktree);
      const options = {
        base: "main",
        claudeConfigDir: tempDir("claude"),
        env: cleanGitEnv(),
        idleLimit: 0,
        facts: {
          containers: [],
          programs: [],
          mounts: [],
          sessions: [],
          processIsGone: () => true,
          processStartTime: () => "proc:different",
          platform: "linux" as const,
          pidNamespace,
        },
      };
      const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
      expect(found?.state).toMatchObject({ finished: false });
      if (found === undefined) throw new Error("missing test worktree");
      expect(removeWorktree(main, found.listed, options).status).toBe("kept");
      expect(git(main, "worktree", "list", "--porcelain")).toContain(`locked ${reason}`);
    },
  );

  test.each(["claude session unreadable identity", "a person's lock"])(
    "unprovable lock reason %s stays even if a PID probe would report gone",
    (reason) => {
      const { main, worktree } = repo();
      git(main, "worktree", "lock", "--reason", reason, worktree);
      const options = {
        base: "main",
        claudeConfigDir: tempDir("claude"),
        env: cleanGitEnv(),
        idleLimit: 0,
        facts: {
          containers: [],
          mounts: [],
          programs: [],
          sessions: [],
          processIsGone: () => true,
          platform: "linux" as const,
          pidNamespace: "pid:[4026531836]",
        },
      };
      const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
      expect(found?.state).toMatchObject({
        finished: false,
        why: `locked: ${reason} (locker cannot be proved gone)`,
      });
      if (found === undefined) throw new Error("missing test worktree");
      expect(removeWorktree(main, found.listed, options).status).toBe("kept");
      expect(git(main, "worktree", "list", "--porcelain")).toContain(`locked ${reason}`);
    },
  );

  test("a stale lock is restored when git cannot move the worktree", () => {
    const { main, worktree } = repo();
    const reason = "claude session ended (pid 424242 start 12345)";
    git(main, "worktree", "lock", "--reason", reason, worktree);
    const bin = tempDir("failing-move");
    const realGit = Bun.which("git");
    if (realGit === null) throw new Error("test requires git");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1 $2" = "worktree move" ]; then printf 'move refused\\n' >&2; exit 1; fi\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    const options = {
      base: "main",
      claudeConfigDir: tempDir("claude"),
      env: { ...cleanGitEnv(), PATH: `${bin}:${process.env.PATH ?? ""}` },
      idleLimit: 0,
      facts: {
        containers: [],
        mounts: [],
        programs: [],
        sessions: [],
        processIsGone: () => true,
        platform: "linux" as const,
        pidNamespace: "pid:[4026531836]",
      },
    };
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    if (found === undefined) throw new Error("missing test worktree");
    expect(removeWorktree(main, found.listed, options).status).toBe("held");
    expect(git(main, "worktree", "list", "--porcelain")).toContain(`locked ${reason}`);
  });

  test.each(["dirty", "local", "container"])(
    "a %s refusal leaves a stale lock in place",
    (blocker) => {
      const { main, worktree } = repo();
      const reason = "claude session ended (pid 424242 start 12345)";
      git(main, "worktree", "lock", "--reason", reason, worktree);
      const options = {
        base: "main",
        claudeConfigDir: tempDir("claude"),
        env: cleanGitEnv(),
        idleLimit: 0,
        facts: {
          containers: blocker === "container" ? [{ name: "service", sources: [worktree] }] : [],
          mounts: [],
          programs: [],
          sessions: [],
          processIsGone: () => true,
          platform: "linux" as const,
          pidNamespace: "pid:[4026531836]",
        },
      };
      const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
      if (found === undefined) throw new Error("missing test worktree");
      if (blocker === "dirty") writeFileSync(join(worktree, "new.txt"), "keep\n");
      if (blocker === "local") {
        writeFileSync(join(main, ".git", "info", "exclude"), "private.txt\n");
        writeFileSync(join(worktree, "private.txt"), "keep private data\n");
      }
      expect(removeWorktree(main, found.listed, options).status).not.toBe("removed");
      expect(existsSync(worktree)).toBe(true);
      expect(git(main, "worktree", "list", "--porcelain")).toContain(`locked ${reason}`);
    },
  );

  test("a stale Claude lock is unlocked only when process identity is proven gone", () => {
    const { main, worktree } = repo();
    git(
      main,
      "worktree",
      "lock",
      "--reason",
      "claude session old-session (pid 424242 start 12345)",
      worktree,
    );
    const options = {
      base: "main",
      claudeConfigDir: join(tempDir("claude"), ".claude"),
      env: cleanGitEnv(),
      now: Date.now() + 60 * 60 * 1000,
      facts: {
        containers: [],
        mounts: [],
        programs: [],
        sessions: [],
        processStartTime: () => null,
        processIsGone: () => false,
        platform: "linux" as const,
        pidNamespace: "pid:[4026531836]",
      },
    };
    const listed = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(listed?.state).toMatchObject({
      finished: false,
      why: "locked by live or unprovable Claude session old-session; its work is on the base — leave it with Claude Code's ExitWorktree (remove), or close that session",
    });
    expect(existsSync(worktree)).toBe(true);

    const gone = {
      ...options,
      facts: { ...options.facts, processStartTime: () => "proc:different" },
    };
    const result = scanWorktrees(main, gone).find((one) => one.listed.path === worktree);
    expect(result?.state).toMatchObject({ finished: true });
    if (result === undefined) throw new Error("missing test worktree");
    const removed = removeWorktree(main, result.listed, gone);
    expect(removed.status).toBe("removed");
    expect(removed.said[0]).toBe(`unlocked stale Claude lock and removed ${worktree}`);
    expect(existsSync(worktree)).toBe(false);
  });

  test("a dead PID's numeric Claude lock can be removed, but an unreadable live PID stays", () => {
    const { main, worktree } = repo();
    git(
      main,
      "worktree",
      "lock",
      "--reason",
      "claude session old-session (pid 424242 start 12345)",
      worktree,
    );
    const options = {
      base: "main",
      claudeConfigDir: join(tempDir("claude"), ".claude"),
      env: cleanGitEnv(),
      now: Date.now() + 60 * 60 * 1000,
      facts: {
        containers: [],
        mounts: [],
        programs: [],
        sessions: [],
        processStartTime: () => null,
        processIsGone: () => false,
        platform: "linux" as const,
        pidNamespace: "pid:[4026531836]",
      },
    };
    expect(
      scanWorktrees(main, options).find((one) => one.listed.path === worktree)?.state,
    ).toMatchObject({ finished: false });
    const dead = { ...options, facts: { ...options.facts, processIsGone: () => true } };
    const found = scanWorktrees(main, dead).find((one) => one.listed.path === worktree);
    expect(found?.state).toMatchObject({ finished: true });
    expect(found === undefined ? null : removeWorktree(main, found.listed, dead).status).toBe(
      "removed",
    );
    expect(existsSync(worktree)).toBe(false);
  });

  test("a branch git still has checked out is kept, and the reason is git's own", () => {
    const { main, worktree } = repo();
    // git refuses while the worktree holds it: the removal deletes the branch afterwards.
    expect(deleteMergedBranch(main, "main", "fix/login", env)).toBe(
      `kept branch fix/login: error: cannot delete branch 'fix/login' used by worktree at '${worktree}'`,
    );
    expect(existsSync(worktree)).toBe(true);
  });

  test("a branch with commits the base does not have is kept, and so is an unknown base", () => {
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "work");
    expect(deleteMergedBranch(main, "main", "fix/login", env)).toBe(
      "kept branch fix/login: it has commits that are not on main",
    );
    expect(deleteMergedBranch(main, "main", "no-such-branch", env)).toContain(
      "kept branch no-such-branch:",
    );
  });

  test("fetching the base never asks for a password", () => {
    const { main, origin } = repo();
    expect(fetchBase(main, "main", env)).toBe(true);
    // A base that is not on the remote: false, and nothing was changed.
    expect(fetchBase(main, "release", env)).toBe(false);
    expect(existsSync(origin)).toBe(true);
  });
});

describe("the base branch a project works against", () => {
  test("`worktrees.base` from the project's file, else the remote's default branch, else main", () => {
    const root = tempDir("worktrees-base");
    const main = join(root, "app");
    mkdirSync(main);
    git(main, "init", "--initial-branch=trunk");
    writeFileSync(join(main, "README.md"), "# app\n");
    git(main, "add", ".");
    git(main, "commit", "-m", "first");
    const env = cleanGitEnv();
    // No remote, no cc-smart-dev-kit.json: the default.
    expect(baseBranch(null, env, main)).toEqual({ base: DEFAULT_BASE, from: "default" });

    // The project says so.
    const config = join(main, ".claude");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "cc-smart-dev-kit.json"),
      JSON.stringify({ worktrees: { base: "trunk" } }),
    );
    const checkout = locateCheckout(main, { env });
    expect(baseBranch(checkout, env, main)).toEqual({ base: "trunk", from: "config" });
    expect(loadProjectConfig(checkout as Checkout).config?.worktrees?.base).toBe("trunk");
  });
});

describe("the worktrees command", () => {
  test("`--clean` runs in the main checkout only", async () => {
    const { main, worktree } = repo();
    const paths = cliPaths({
      CLAUDE_CONFIG_DIR: join(main, ".claude-config"),
      HOME: main,
    });
    const errors: string[] = [];
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "));
    });
    const logged = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: true, json: false, noFetch: true, remove: null },
          cleanGitEnv(),
          worktree,
          undefined,
          freeLock,
        ),
      ).toBe(1);
    } finally {
      error.mockRestore();
      logged.mockRestore();
    }
    expect(errors[0]).toContain(`Run this in the main checkout, ${main}.`);
    expect(existsSync(worktree)).toBe(true);
  });

  test("`--json` prints the same facts as one object, and changes nothing", async () => {
    const { main, worktree } = repo();
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: true, noFetch: true, remove: null },
          cleanGitEnv(),
          main,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    // One line on stdout, nothing else: the answer a page reads.
    expect(out).toHaveLength(1);
    const answer = JSON.parse(out[0] ?? "") as {
      autoClean: unknown;
      base: string;
      from: string;
      note: null | string;
      worktrees: { kind: string; path: string }[];
    };
    expect(answer.base).toBe("main");
    // No project file: the remote's own default branch is the base.
    expect(answer.from).toBe("origin");
    expect(answer.note).toBe(null);
    expect(answer.autoClean).toBe(null);
    expect(answer.worktrees.map((one) => [one.kind, one.path])).toEqual([
      ["main", main],
      // Freshly made, so not finished yet: the verdict itself has its own tests.
      ["kept", worktree],
    ]);
    // A read: the worktree is still there.
    expect(existsSync(worktree)).toBe(true);
  });

  test("`--json` from a folder that is no git project says so, as the portal's normal start does", async () => {
    // The portal usually starts in the home folder, which is no project: the page shows this
    // line, never an empty list that looks like a machine without worktrees.
    const home = tempDir("worktrees-home-no-git");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude-config"), HOME: home });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: true, noFetch: true, remove: null },
          cleanGitEnv(),
          home,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    const answer = JSON.parse(out[0] ?? "") as WorktreesAnswer;
    expect(answer).toEqual({
      autoClean: null,
      base: "",
      from: "default",
      note: "this folder is not in a git project, so there is no work to show",
      worktrees: [],
    });
  });

  test("`--json` answers with the reason when the project's file cannot be read", async () => {
    const { main } = repo();
    mkdirSync(join(main, ".claude"), { recursive: true });
    writeFileSync(join(main, ".claude", "cc-smart-dev-kit.json"), "{ not json\n");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: true, noFetch: true, remove: null },
          cleanGitEnv(),
          main,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    // A note, never a stack trace: the page shows the reason it could not read the project.
    expect(out).toHaveLength(1);
    const answer = JSON.parse(out[0] ?? "") as { note: null | string; worktrees: unknown[] };
    expect(answer.note).toContain("cc-smart-dev-kit.json");
    expect(answer.worktrees).toEqual([]);
  });

  test("D62: the mark a removal gives a folder it moves aside is read back, once or repeated", () => {
    expect(
      isParkedWorktree("/work/app/.claude/worktrees/agent-B1-help-removing-1761300000000"),
    ).toBe(true);
    expect(parkedOriginal("/work/app/.claude/worktrees/agent-B1-help-removing-1761300000000")).toBe(
      "/work/app/.claude/worktrees/agent-B1-help",
    );
    // An older removal moved a parked folder again: every mark comes off, not only the last.
    expect(
      parkedOriginal(
        "/work/app/.claude/worktrees/agent-B1-help-removing-1761300000000-removing-1761300090000",
      ),
    ).toBe("/work/app/.claude/worktrees/agent-B1-help");
    // A worktree that is not one, and a name that only looks like one.
    expect(isParkedWorktree("/work/app/.claude/worktrees/agent-B1-help")).toBe(false);
    expect(parkedOriginal("/work/app/.claude/worktrees/agent-B1-help")).toBeNull();
    expect(isParkedWorktree("/work/app/.claude/worktrees/removing-things")).toBe(false);
    expect(isParkedWorktree("/work/app-removing-1761300000000/.claude/worktrees/x")).toBe(false);
  });

  test("D62: a removal that stopped halfway keeps its work on its branch and is finished", () => {
    const { main, worktree } = repo();
    // The session's own commit: on its branch, and on no other ref the base reads.
    writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "work");
    const parked = `${worktree}-removing-1761300000000`;
    git(main, "worktree", "move", worktree, parked);
    const options = {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env: cleanGitEnv(),
      facts: { containers: [], programs: [], sessions: [] },
    };
    const found = scanWorktrees(main, options).find((one) => one.listed.path === parked);
    // Judged now: no idle hour, and 1 commit ahead of the base is its branch's to keep.
    expect(found?.state).toEqual({ finished: true, note: null });
    const listed = found?.listed;
    if (listed === undefined) throw new Error("the parked folder is not listed");
    const removal = removeWorktree(main, listed, options);
    expect(removal.status).toBe("removed");
    expect(removal.said).toEqual([
      `removed ${parked}`,
      "kept branch fix/login: it has commits that are not on main",
    ]);
    expect(existsSync(parked)).toBe(false);
    // The commit is still there, on the branch the folder had.
    expect(git(main, "log", "--format=%s", "-1", "fix/login").trim()).toBe("work");
  });

  test("D62: the tracked files a half-done removal deleted are its own, anything else is not", () => {
    const { main, worktree } = repo();
    const parked = `${worktree}-removing-1761300000000`;
    git(main, "worktree", "move", worktree, parked);
    // `git worktree remove` deleted a tracked file before it failed.
    rmSync(join(parked, "README.md"));
    const options = {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env: cleanGitEnv(),
      facts: { containers: [], programs: [], sessions: [] },
    };
    const state = () =>
      scanWorktrees(main, options).find((one) => one.listed.path === parked)?.state;
    expect(state()).toEqual({ finished: true, note: null });
    // A file someone changed is not the removal's own work.
    writeFileSync(join(parked, "README.md"), "# mine\n");
    expect(state()).toMatchObject({ finished: false, why: "uncommitted changes" });
    git(parked, "checkout", "--", "README.md");
    expect(state()).toEqual({ finished: true, note: null });
    // Nor is a file nobody tracks.
    writeFileSync(join(parked, "notes.txt"), "mine\n");
    expect(state()).toMatchObject({ finished: false, why: "uncommitted changes" });
  });

  test("D62: a folder that moved aside on a detached head keeps the commits the base lacks", () => {
    const { main, worktree } = repo();
    git(worktree, "checkout", "--detach");
    writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "work");
    const parked = `${worktree}-removing-1761300000000`;
    git(main, "worktree", "move", worktree, parked);
    const found = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env: cleanGitEnv(),
      facts: { containers: [], programs: [], sessions: [] },
    }).find((one) => one.listed.path === parked);
    // No branch holds this commit: removing the folder would lose it.
    expect(found?.state).toMatchObject({ finished: false, why: "1 commit not on main" });
  });

  test("D62: a folder already moved aside is removed where it stands, never moved again", () => {
    const { main, worktree } = repo();
    const parked = `${worktree}-removing-1761300000000`;
    git(main, "worktree", "move", worktree, parked);
    // The name a second move would take is taken. A move would fail on it (and a removal that
    // moved first would be held); a removal in place does not need it.
    const realNow = Date.now;
    Date.now = () => 1761300090000;
    mkdirSync(`${parked}-removing-1761300090000`);
    try {
      const options = {
        base: "main",
        claudeConfigDir: tempDir("worktrees-config"),
        env: cleanGitEnv(),
        facts: { containers: [], programs: [], sessions: [] },
        idleLimit: 0,
      };
      const listed = scanWorktrees(main, options).find((one) => one.listed.path === parked)?.listed;
      if (listed === undefined) throw new Error("the parked folder is not listed");
      const removal = removeWorktree(main, listed, options);
      expect(removal.status).toBe("removed");
      expect(removal.said[0]).toBe(`removed ${parked}`);
      expect(existsSync(parked)).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  describe("D62: a folder git no longer lists, left by a removal that stopped halfway", () => {
    /** The moment the removal moved it aside, in the name `removeWorktree` gives it. */
    const PARKED_AT = 1761300000000;

    /**
     * What `git worktree remove` leaves when it fails midway: git has deleted the registration,
     * the `.git` file and most of the files, and what it could not delete stays. The files keep
     * the time they were written, which is before the move.
     */
    function leftover(
      root: string,
      name = "app-wt-gone",
      files = ["docs/guide.md", "next.config.ts"],
    ) {
      const folder = join(root, `${name}-removing-${String(PARKED_AT)}`);
      for (const file of files) {
        mkdirSync(dirname(join(folder, file)), { recursive: true });
        writeFileSync(join(folder, file), "left\n");
        const before = new Date(PARKED_AT - 60_000);
        utimesSync(join(folder, file), before, before);
      }
      return folder;
    }

    const options = (facts: Record<string, unknown> = {}) => ({
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env: cleanGitEnv(),
      facts: { containers: [], programs: [], sessions: [], ...facts },
    });

    test("it is found beside the worktrees git lists, and nothing else is", () => {
      const { main, worktree } = repo();
      const root = dirname(main);
      const folder = leftover(root);
      // Not strays: a name without the mark, the registered worktree, and a plain file with it.
      mkdirSync(join(root, "app-wt-notes"));
      writeFileSync(join(root, `app-wt-file-removing-${String(PARKED_AT)}`), "x\n");
      expect(strayParkedFolders(main, cleanGitEnv())).toEqual([
        { parkedAt: PARKED_AT, path: folder },
      ]);
      expect(existsSync(worktree)).toBe(true);
    });

    test("--clean removes it when nothing runs from it and nothing was written after the move", async () => {
      const { main } = repo();
      const folder = leftover(dirname(main));
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
      const out: string[] = [];
      const sinks = {
        error: (line: string) => out.push(line),
        print: (line: string) => out.push(line),
      };
      expect(
        await runWorktrees(
          paths,
          { clean: true, json: false, noFetch: true, remove: null },
          cleanGitEnv(),
          main,
          sinks,
          freeLock,
        ),
      ).toBe(0);
      expect(existsSync(folder)).toBe(false);
      expect(out.join("\n")).toContain(
        `removed ${folder} (left by a removal that stopped halfway; git no longer lists it)`,
      );
    });

    test("plain `worktrees` names it and changes nothing", async () => {
      const { main } = repo();
      const folder = leftover(dirname(main));
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
      const out: string[] = [];
      const sinks = {
        error: (line: string) => out.push(line),
        print: (line: string) => out.push(line),
      };
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: false, noFetch: true, remove: null },
          cleanGitEnv(),
          main,
          sinks,
          freeLock,
        ),
      ).toBe(0);
      expect(existsSync(folder)).toBe(true);
      const text = out.join("\n");
      expect(text).toContain("app-wt-gone-removing-1761300000000");
      expect(text).toContain("left by a removal that stopped halfway");
      expect(text).toContain("`cc-smart-dev-kit worktrees --clean`");
    });

    test("a file written after the move keeps it, and says which", () => {
      const { main } = repo();
      const folder = leftover(dirname(main));
      // Newer than the move: something wrote here since, and it is not the removal's own.
      writeFileSync(join(folder, "mine.txt"), "someone's notes\n");
      const pass = finishStrays(main, options(), () => undefined);
      expect(pass.removed).toEqual([]);
      expect(pass.kept).toEqual([
        { path: folder, why: "files were written in it after the removal moved it: mine.txt" },
      ]);
      expect(existsSync(join(folder, "mine.txt"))).toBe(true);
    });

    test("a program that runs from it, a session in it or a container on it keeps it", () => {
      const { main } = repo();
      const folder = leftover(dirname(main));
      const whyKept = (facts: Record<string, unknown>) =>
        finishStrays(main, options(facts), () => undefined).kept.map((one) => one.why);
      expect(whyKept({ programs: [{ cwd: folder, path: "/usr/bin/bun dev", pid: 9 }] })).toEqual([
        "a program runs from its files: bun",
      ]);
      expect(
        whyKept({ sessions: [{ cwd: folder, name: "busy", pid: 9, sessionId: "s" }] }),
      ).toEqual(['Claude session "busy" works in it']);
      expect(whyKept({ containers: [{ name: "db", sources: [folder] }] })).toEqual([
        'Docker container "db" uses its files',
      ]);
      expect(whyKept({ programs: "unknown" })[0]).toContain("could not be listed");
      expect(existsSync(folder)).toBe(true);
    });

    test("a repository of its own is never removed", () => {
      const { main } = repo();
      const own = leftover(dirname(main), "app-wt-clone");
      git(own, "init", "-q");
      expect(finishStrays(main, options(), () => undefined).kept).toEqual([
        { path: own, why: "it holds a git repository of its own" },
      ]);
      expect(existsSync(own)).toBe(true);
    });

    test("it goes with its links, and nothing outside it goes", () => {
      const { main } = repo();
      const root = dirname(main);
      const folder = leftover(root);
      const outside = join(root, "precious.txt");
      writeFileSync(outside, "keep me\n");
      symlinkSync(outside, join(folder, "link-out"));
      const before = new Date(PARKED_AT - 60_000);
      lutimesSync(join(folder, "link-out"), before, before);
      expect(finishStrays(main, options(), () => undefined).removed).toEqual([folder]);
      expect(existsSync(folder)).toBe(false);
      expect(existsSync(outside)).toBe(true);
    });
  });

  test("D62: a removal that stopped halfway is finished by --clean, with no record of it", async () => {
    const { main, worktree } = repo();
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    // What `removeWorktree` leaves when `git worktree remove` fails on the folder it moved
    // aside: no record names the parked path, and the move itself is the removal's touch.
    const parked = `${worktree}-removing-1761300000000`;
    git(main, "worktree", "move", worktree, parked);
    const out: string[] = [];
    const sinks = {
      error: (line: string) => out.push(line),
      print: (line: string) => out.push(line),
    };
    expect(
      await runWorktrees(
        paths,
        { clean: true, json: false, noFetch: true, remove: null },
        cleanGitEnv(),
        main,
        sinks,
        freeLock,
      ),
    ).toBe(0);
    expect(out.join("\n")).toContain(`removed ${parked}`);
    expect(existsSync(parked)).toBe(false);
    expect(git(main, "worktree", "list")).not.toContain("-removing-");
  });

  test("`--remove <path>` removes one now, without the one-hour wait", async () => {
    const { main, worktree } = repo();
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
          undefined,
          freeLock,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    expect(out.join("\n")).toContain(`removing ${worktree} …`);
    expect(out.join("\n")).toContain("deleted branch fix/login");
    expect(existsSync(worktree)).toBe(false);
  });

  test("another clean holds the machine-wide lock: nothing is removed, and it says so", async () => {
    const { main, worktree } = repo();
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
          undefined,
          async () => null,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    expect(out).toEqual([
      "No `worktrees.base` in .claude/cc-smart-dev-kit.json: judging against main.\n",
      "Another `cc-smart-dev-kit worktrees` is removing worktrees right now. Nothing done.",
    ]);
    expect(existsSync(worktree)).toBe(true);
  });

  test("`--remove <path>` exits 1 when the removal was kept, and says why", async () => {
    const { main, worktree } = repo();
    writeFileSync(join(worktree, "notes.local.md"), "mine\n");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
          undefined,
          freeLock,
        ),
      ).toBe(1);
    } finally {
      logged.mockRestore();
    }
    expect(out.join("\n")).toContain("uncommitted changes");
    expect(existsSync(worktree)).toBe(true);
  });

  test("`--remove <path>` exits 1 while a program works in it", async () => {
    const { main, worktree } = repo();
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const child = Bun.spawn(["sleep", "30"], {
      cwd: worktree,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      // The scan reads this machine's own processes: the sleep below works in the worktree.
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
          undefined,
          freeLock,
        ),
      ).toBe(1);
    } finally {
      logged.mockRestore();
      child.kill();
    }
    expect(out.join("\n")).toContain("a program runs from its files: sleep");
    expect(existsSync(worktree)).toBe(true);
  });

  test.skipIf(process.getuid?.() === 0)(
    "`--remove <path>` exits 1 when the move worked and git could not delete the folder",
    async () => {
      const { main, worktree } = repo();
      // A folder git cannot delete: the move aside works, the removal then fails, and the
      // worktree is left parked. Nothing may report that as a removal.
      mkdirSync(join(worktree, "locked"));
      writeFileSync(join(worktree, "locked", "f.txt"), "x\n");
      git(worktree, "add", ".");
      git(worktree, "commit", "-q", "-m", "a file in a folder that cannot be deleted");
      git(main, "merge", "--ff-only", "fix/login");
      git(main, "push", "-q", "origin", "main");
      chmodSync(join(worktree, "locked"), 0o555);
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
      const out: string[] = [];
      const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        out.push(args.join(" "));
      });
      try {
        expect(
          await runWorktrees(
            paths,
            { clean: false, json: false, noFetch: true, remove: worktree },
            cleanGitEnv(),
            main,
            undefined,
            freeLock,
          ),
        ).toBe(1);
      } finally {
        logged.mockRestore();
        // Leave nothing unreadable behind, for the temp folder's own cleanup.
        for (const name of readdirSync(dirname(worktree))) {
          if (!name.startsWith("app-wt-fix-login")) continue;
          try {
            chmodSync(join(dirname(worktree), name, "locked"), 0o755);
          } catch {
            // Already gone.
          }
        }
      }
      expect(out.join("\n")).toContain("then could not remove it");
      expect(existsSync(worktree)).toBe(false);
    },
  );

  test("a worktree whose folder is gone: the line says to lock one on a disk that is not connected", async () => {
    const { main, worktree } = repo();
    Bun.spawnSync(["rm", "-rf", worktree]);
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(main, ".claude-config"), HOME: main });
    const out: string[] = [];
    const logged = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runWorktrees(
          paths,
          { clean: false, json: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
          undefined,
          freeLock,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    expect(out.join("\n")).toContain(
      `forgot ${worktree} (its folder was already gone). A worktree on a disk that is not connected reads the same way: lock one there (\`git worktree lock "${worktree}"\`) and prune leaves it alone.`,
    );
  });
});
