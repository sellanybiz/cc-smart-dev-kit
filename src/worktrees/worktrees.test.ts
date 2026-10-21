/**
 * `cc-smart-dev-kit worktrees`: which worktrees are finished, and removing them.
 *
 * The scan runs against a real git repo in a temp folder — a bare "origin" and one linked
 * worktree — with the machine's own facts given (no Docker, no processes, no sessions), so
 * nothing here reads the host.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { baseBranch, DEFAULT_BASE, runWorktrees } from "./command";
import {
  containersUsing,
  hostPath,
  parseCommandLines,
  parseContainerMounts,
  parsePrograms,
  programsInside,
} from "./machine-facts";
import { deleteMergedBranch, fetchBase, removeWorktree, scanWorktrees } from "./scan";
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
  idleMinutes: IDLE_MINUTES + 1,
  innerWorktree: null,
  locked: false,
  programs: [],
  sessionName: null,
  ...over,
});

const clean = { localFiles: [], uncommitted: false };

describe("the verdict on one worktree", () => {
  test("everything clean: finished", () => {
    expect(verdict(facts(), () => clean)).toEqual({ finished: true });
  });

  test("each reason to keep it, with the words a person reads", () => {
    expect(verdict(facts({ locked: true }), () => clean)).toEqual({
      finished: false,
      why: "locked with `git worktree lock`",
    });
    expect(verdict(facts({ sessionName: "Fix the login bug" }), () => clean)).toEqual({
      finished: false,
      why: 'Claude session "Fix the login bug" works in it',
    });
    expect(verdict(facts({ programs: ["bun"] }), () => clean)).toEqual({
      finished: false,
      why: "a program runs from its files: bun",
    });
    expect(verdict(facts({ containers: ["db"] }), () => clean)).toEqual({
      finished: false,
      why: 'Docker container "db" uses its files',
    });
    expect(
      verdict(facts({ innerWorktree: "/work/app-wt-x/.claude/worktrees/agent-1" }), () => clean),
    ).toEqual({
      finished: false,
      why: "another worktree lives inside it: /work/app-wt-x/.claude/worktrees/agent-1",
    });
    expect(verdict(facts({ aheadOfBase: 3 }), () => clean)).toEqual({
      finished: false,
      why: "3 commits not on main",
    });
    expect(verdict(facts({ aheadOfBase: 1 }), () => clean)).toEqual({
      finished: false,
      why: "1 commit not on main",
    });
    expect(verdict(facts({ idleMinutes: 5 }), () => clean)).toEqual({
      finished: false,
      why: "git used it 5 min ago",
    });
    expect(verdict(facts(), () => ({ localFiles: [], uncommitted: true }))).toEqual({
      finished: false,
      why: "uncommitted changes",
    });
    expect(
      verdict(facts(), () => ({
        localFiles: [".env.local", "notes.local.md"],
        uncommitted: false,
      })),
    ).toEqual({
      finished: false,
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
    expect(verdict(facts({ idleMinutes: 0 }), () => clean, 0)).toEqual({ finished: true });
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
    const scanned = scanWorktrees(main, {
      base: "main",
      claudeConfigDir: tempDir("worktrees-config"),
      env,
      facts: { containers: [], programs: [], sessions: [] },
      // git wrote the worktree's admin files just now: the one-hour wait is what `--remove`
      // skips, and this is the same test of the rest of the verdict.
      idleLimit: 0,
    });
    const linked = scanned.filter((entry) => entry.state !== "main");
    expect(linked).toHaveLength(1);
    expect(linked[0]?.state).toEqual({ finished: true });
    expect(linked[0]?.listed.branch).toBe("fix/login");

    const listed = linked[0]?.listed;
    if (listed === undefined) throw new Error("the worktree is not listed");
    const removal = removeWorktree(main, listed, env, "main");
    expect(removal.status).toBe("removed");
    expect(removal.said).toEqual([`removed ${worktree}`, "deleted branch fix/login"]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(main, "branch", "--list", "fix/login")).toBe("");
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
    expect(withCommit[1]?.state).toEqual({ finished: false, why: "1 commit not on main" });

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
    expect(withFile[1]?.state).toEqual({ finished: false, why: "uncommitted changes" });
    const withFileListed = withFile[1]?.listed;
    if (withFileListed === undefined) throw new Error("the worktree is not listed");
    const removal = removeWorktree(main, withFileListed, env, "main");
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
    expect(held[1]?.state).toEqual({ finished: false, why: "a program runs from its files: bun" });
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
          { clean: true, noFetch: true, remove: null },
          cleanGitEnv(),
          worktree,
        ),
      ).toBe(1);
    } finally {
      error.mockRestore();
      logged.mockRestore();
    }
    expect(errors[0]).toContain(`Run this in the main checkout, ${main}.`);
    expect(existsSync(worktree)).toBe(true);
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
          { clean: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
        ),
      ).toBe(0);
    } finally {
      logged.mockRestore();
    }
    expect(out.join("\n")).toContain(`removing ${worktree} …`);
    expect(out.join("\n")).toContain("deleted branch fix/login");
    expect(existsSync(worktree)).toBe(false);
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
          { clean: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
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
          { clean: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
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
            { clean: false, noFetch: true, remove: worktree },
            cleanGitEnv(),
            main,
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
          { clean: false, noFetch: true, remove: worktree },
          cleanGitEnv(),
          main,
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
