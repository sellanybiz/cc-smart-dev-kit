/**
 * `cc-smart-dev-kit sessions`: reading Claude Code's saved sessions, and bringing back the
 * ones a restart or a closed window stopped.
 */
import { describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { type ListedWorktree, listWorktrees } from "../hooks/git";
import { makeRepo } from "../testing/hooks";
import { sessionProcessIdentity } from "../testing/session-record";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import {
  markOpened,
  OPENED_AGAIN_MINUTES,
  openedMarkerFile,
  runSessions,
  savedSessions,
} from "./command";
import {
  belongsToRepo,
  closedWithWindow,
  describeSession,
  desktopLaunch,
  pickReopenTerminal,
  projectFolderName,
  type SavedSession,
  sessionLabel,
  sessionsToReopen,
  stoppedByRestart,
  windowsTerminalCommand,
  worktreeProjectFolders,
  xfceTerminalCommand,
} from "./saved-sessions";

/** One line of a session file, as Claude Code writes it. */
const line = (fields: Record<string, unknown>): string => `${JSON.stringify(fields)}\n`;

const session = (over: Partial<SavedSession> = {}): SavedSession => ({
  branch: null,
  endedCleanly: true,
  folder: "/work/my-app",
  id: "aaaaaaaa-1111-2222-3333-444444444444",
  lastWrite: 1000,
  model: null,
  name: "a session",
  ...over,
});

describe("reading a saved session", () => {
  test("the name, the folder and the worktree come from the end of the file", () => {
    const tail = [
      line({ cwd: "/work/my-app", type: "user" }),
      line({ agentName: "Fix the login bug", type: "agent-name" }),
      line({ cwd: "/work/my-app-wt-fix-login", type: "assistant" }),
      line({
        type: "worktree-state",
        worktreeSession: { worktreeBranch: "fix/login", worktreePath: "/work/my-app-wt-fix-login" },
      }),
      line({ type: "system" }),
      line({ type: "cost-state" }),
    ].join("");
    expect(describeSession(tail, { id: "abc", lastWrite: 42 })).toEqual({
      branch: "fix/login",
      endedCleanly: true,
      folder: "/work/my-app-wt-fix-login",
      id: "abc",
      lastWrite: 42,
      model: null,
      name: "Fix the login bug",
    });
  });

  test("the model is the last reply's own, and Claude Code's synthetic stand-in is not one", () => {
    const reply = (model: string) =>
      line({ message: { model, role: "assistant" }, type: "assistant" });
    const tail =
      reply("claude-opus-5-5") +
      line({ type: "user" }) +
      reply("glm-5.3-flash") +
      reply("<synthetic>") +
      line({ type: "system" });
    expect(describeSession(tail, { id: "abc", lastWrite: 3 }).model).toBe("glm-5.3-flash");
    // A tail with no reply names no model.
    expect(describeSession(line({ type: "user" }), { id: "abc", lastWrite: 3 }).model).toBeNull();
  });

  test("the title Claude gave it, when the person renamed nothing; a moved session's new folder", () => {
    const tail =
      line({ aiTitle: "Add the export button", type: "ai-title" }) +
      line({ relocatedCwd: "/work/elsewhere", type: "relocated" }) +
      line({ type: "user" });
    const read = describeSession(tail, { id: "abc", lastWrite: 1 });
    expect(read.name).toBe("Add the export button");
    expect(read.folder).toBe("/work/elsewhere");
    // No end marker: not closed by Claude Code itself (still running, or killed).
    expect(read.endedCleanly).toBe(false);
  });

  test("a session that left its worktree has no branch; a broken line is skipped", () => {
    const tail =
      "half a line at the start…\n" +
      line({ type: "worktree-state", worktreeSession: null }) +
      "not json at all\n" +
      line({ type: "cost-state" });
    expect(describeSession(tail, { id: "abc", lastWrite: 2 }).branch).toBeNull();
    expect(describeSession(tail, { id: "abc", lastWrite: 2 }).endedCleanly).toBe(true);
  });

  test("the label a person recognises: its name, and the worktree it works in", () => {
    expect(sessionLabel(session())).toBe("a session — my-app");
    expect(sessionLabel(session({ folder: null }))).toBe("a session");
    expect(sessionLabel(session({ name: null }))).toBe("session aaaaaaaa — my-app");
  });

  test("a long folder's name is cut at 200 characters and ends with a hash of the whole path (seen live, 2.1.310)", () => {
    // The names below are what Claude Code 2.1.310 itself made for sessions started in these
    // folders (a throwaway config; the expected hashes are read from its project folders).
    const at200 = `/tmp/ar1-probe/${"c".repeat(185)}`;
    expect(at200).toHaveLength(200);
    expect(projectFolderName(at200)).toBe(`-tmp-ar1-probe-${"c".repeat(185)}`);
    expect(projectFolderName(at200)).toHaveLength(200);

    const at201 = `/tmp/ar1-probe/${"c".repeat(186)}`;
    expect(projectFolderName(at201)).toBe(`-tmp-ar1-probe-${"c".repeat(185)}-mewvn1`);

    const mixed = `/tmp/ar1-probe/${"work-tree.x_".repeat(17)}${"y".repeat(48)}`;
    expect(mixed).toHaveLength(267);
    expect(projectFolderName(mixed)).toBe(
      `${`-tmp-ar1-probe-${"work-tree-x-".repeat(17)}${"y".repeat(48)}`.slice(0, 200)}-tcfihq`,
    );
  });

  test("Claude Code's project folder names, and which of them are this project's", () => {
    expect(projectFolderName("/work/my-app")).toBe("-work-my-app");
    expect(projectFolderName("C:\\work\\my-app")).toBe("C--work-my-app");
    // Claude Code's own worktrees: `<repo>/.claude/worktrees/<name>`, nested in the repo.
    expect(belongsToRepo("-work-my-app--claude-worktrees-fix-login", "/work/my-app")).toBe(true);
    expect(belongsToRepo("C--work-my-app--claude-worktrees-fix-login", "C:\\work\\my-app")).toBe(
      true,
    );
    // Another project's folder is never this one's.
    expect(belongsToRepo("-work-another-project", "/work/my-app")).toBe(false);
    expect(belongsToRepo("-work-my-app-notes", "/work/my-app")).toBe(false);
  });

  test("CM-5: a sibling project is not this project", () => {
    // Every project uses Claude Code's own worktrees, which live inside the checkout. A
    // folder beside the checkout in the parent folder belongs to another project, and
    // listing it (or reopening it with --open) would work in the wrong project.
    expect(belongsToRepo("-work-my-app", "/work/my-app")).toBe(true);
    expect(belongsToRepo("-work-my-app--claude-worktrees-agent-a1b2", "/work/my-app")).toBe(true);
    expect(belongsToRepo("-work-other-project", "/work/my-app")).toBe(false);
    expect(belongsToRepo("-work-my-app-wt-topic", "/work/my-app")).toBe(false);
  });

  test("CM-5: the sessions command lists only this project's folders", () => {
    const projectsDir = tempDir("sessions-projects");
    const main = "/work/my-app";
    const folders = [
      { file: projectFolderName(main), name: "the main checkout" },
      { file: projectFolderName(`${main}/.claude/worktrees/agent-a1b2c3`), name: "inside it" },
      { file: projectFolderName("/work/other-project"), name: "another project" },
      { file: projectFolderName("/work/my-app-wt-topic"), name: "another project's worktree" },
    ];
    let number = 0;
    for (const folder of folders) {
      number += 1;
      mkdirSync(join(projectsDir, folder.file), { recursive: true });
      writeFileSync(
        join(
          projectsDir,
          folder.file,
          `aaaaaaa${String(number)}-1111-2222-3333-444444444444.jsonl`,
        ),
        line({ agentName: folder.name, type: "agent-name" }),
      );
    }
    expect(
      savedSessions(projectsDir, main, 0)
        .map((one) => one.name)
        .sort(),
    ).toEqual(["inside it", "the main checkout"]);
  });

  /** One session file, named by `name`, in the project folder Claude Code makes for `cwd`. */
  function sessionIn(projectsDir: string, cwd: string, name: string, number: number): void {
    const folder = join(projectsDir, projectFolderName(cwd));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `bbbbbbb${String(number)}-1111-2222-3333-444444444444.jsonl`),
      line({ agentName: name, type: "agent-name" }),
    );
  }

  test("a worktree git lists outside .claude/worktrees is this project's, by its exact folder (a project's own WorktreeCreate hook)", () => {
    const repo = makeRepo("my-app");
    const elsewhere = join(tempDir("elsewhere"), "feature-x");
    git(repo, "worktree", "add", "-q", "-b", "feat-x", elsewhere);
    const projectsDir = tempDir("sessions-projects");
    sessionIn(projectsDir, elsewhere, "in the hook's worktree", 1);
    sessionIn(projectsDir, `${elsewhere}-sibling`, "beside it", 2);
    sessionIn(
      projectsDir,
      join(dirname(elsewhere), "other-project"),
      "its parent's other folder",
      3,
    );
    sessionIn(projectsDir, repo, "the main checkout", 4);
    const listed = listWorktrees(repo, cleanGitEnv());
    expect(
      savedSessions(projectsDir, repo, 0, listed)
        .map((one) => one.name)
        .sort(),
    ).toEqual(["in the hook's worktree", "the main checkout"]);
    // Without a listing (git could not say), today's rule stands.
    expect(savedSessions(projectsDir, repo, 0, null).map((one) => one.name)).toEqual([
      "the main checkout",
    ]);
  });

  test("a listed folder that is spelled through a link also matches by its real path", () => {
    const repo = makeRepo("my-app");
    const real = join(tempDir("real"), "feature-y");
    mkdirSync(real);
    const linkParent = tempDir("links");
    symlinkSync(dirname(real), join(linkParent, "via"));
    const throughLink = join(linkParent, "via", "feature-y");
    const listed: ListedWorktree[] = [
      { branch: "main", head: "", locked: false, path: repo, prunable: false },
      { branch: "feat-y", head: "", locked: false, path: throughLink, prunable: false },
    ];
    const projectsDir = tempDir("sessions-projects");
    // Claude Code saw the real folder as its cwd; git printed the link's spelling.
    sessionIn(projectsDir, real, "by its real path", 1);
    sessionIn(projectsDir, throughLink, "by the link's path", 2);
    expect(
      savedSessions(projectsDir, repo, 0, listed)
        .map((one) => one.name)
        .sort(),
    ).toEqual(["by its real path", "by the link's path"]);
    expect(savedSessions(projectsDir, repo, 0, null)).toEqual([]);
  });

  test("a Windows-shaped path matches in both separator forms and with either drive letter case", () => {
    const listed = ["C:/work/hooked/feature"];
    const names = worktreeProjectFolders(listed);
    expect(belongsToRepo("C--work-hooked-feature", "C:\\work\\app", names)).toBe(true);
    expect(belongsToRepo("c--work-hooked-feature", "C:\\work\\app", names)).toBe(true);
    // A folder beside it, or its parent, is not.
    expect(belongsToRepo("C--work-hooked-feature-2", "C:\\work\\app", names)).toBe(false);
    expect(belongsToRepo("C--work-hooked", "C:\\work\\app", names)).toBe(false);
  });

  test("a path over 200 characters is matched by its hash, in both separator forms", () => {
    const long = `C:/work/${"deep-folder-".repeat(20)}feature`;
    const names = worktreeProjectFolders([long]);
    // Claude Code hashes the raw cwd it saw: `C:\…` is one spelling and `C:/…` another.
    expect(projectFolderName(long)).not.toBe(projectFolderName(long.replaceAll("/", "\\")));
    for (const seen of [long, long.replaceAll("/", "\\"), `c${long.slice(1)}`]) {
      expect(belongsToRepo(projectFolderName(seen), "C:\\work\\app", names)).toBe(true);
    }
    expect(belongsToRepo(projectFolderName(`${long}x`), "C:\\work\\app", names)).toBe(false);
  });
});

describe("the supported terminals", () => {
  test("the XFCE Terminal window: a login shell, and never an id that is not a session's", () => {
    const argv = xfceTerminalCommand(session(), "/work/my-app");
    expect(argv).toContain("--working-directory=/work/my-app");
    expect(argv?.at(-1)).toBe("claude --resume aaaaaaaa-1111-2222-3333-444444444444; exec bash -l");
    expect(xfceTerminalCommand(session({ id: "not a session; rm -rf /" }), "/work")).toBeNull();
  });

  test("the Windows Terminal window: in the main checkout, resuming, and it stays open", () => {
    expect(windowsTerminalCommand(session(), "C:\\work\\my-app")).toEqual([
      "wt.exe",
      "-d",
      "C:\\work\\my-app",
      "cmd",
      "/k",
      "claude --resume aaaaaaaa-1111-2222-3333-444444444444",
    ]);
    expect(
      windowsTerminalCommand(session({ id: "not a session; rm -rf /" }), "C:\\work"),
    ).toBeNull();
  });

  test("which terminal brings sessions back ignores retired Warp programs", () => {
    const has = (names: string[]) => (name: string) => names.includes(name);
    expect(pickReopenTerminal({ hasProgram: has(["warp-terminal"]), platform: "linux" })).toBe(
      "nowhere",
    );
    expect(
      pickReopenTerminal({
        hasProgram: has(["warp-terminal", "xfce4-terminal"]),
        platform: "linux",
      }),
    ).toBe("xfce-terminal");
    expect(pickReopenTerminal({ hasProgram: has([]), platform: "darwin" })).toBe("nowhere");
    expect(pickReopenTerminal({ hasProgram: has(["wt.exe"]), platform: "win32" })).toBe(
      "windows-terminal",
    );
    expect(pickReopenTerminal({ hasProgram: has(["xfce4-terminal"]), platform: "win32" })).toBe(
      "nowhere",
    );
  });

  test("a window on the Linux desktop opens through systemd-run where there is one", () => {
    expect(desktopLaunch(["xfce4-terminal"], { outlivesCommand: false, systemdRun: true })).toEqual(
      ["systemd-run", "--user", "--wait", "--collect", "--quiet", "--", "xfce4-terminal"],
    );
    expect(
      desktopLaunch(["xdg-open", "https://example.com"], {
        outlivesCommand: true,
        systemdRun: true,
      }),
    ).toContain("--property=ExitType=cgroup");
    expect(
      desktopLaunch(["xdg-open", "https://example.com"], {
        outlivesCommand: true,
        systemdRun: false,
      }),
    ).toEqual(["xdg-open", "https://example.com"]);
  });
});

describe("which sessions a restart or a closed window stopped", () => {
  const started = 10 * 3_600_000;

  test("a session killed before the machine started comes back; one before the limit does not", () => {
    const killed = session({ endedCleanly: false, id: "killed", lastWrite: started - 1000 });
    const old = session({ endedCleanly: false, id: "old", lastWrite: started - 20 * 3_600_000 });
    expect(stoppedByRestart([killed, old], started, 12).map((s) => s.id)).toEqual(["killed"]);
  });

  test("sessions that closed together before the start were closed by the shutdown; one alone was not", () => {
    const together = [
      session({ id: "a", lastWrite: started - 5000 }),
      session({ id: "b", lastWrite: started - 4800 }),
    ];
    const alone = session({ id: "alone", lastWrite: started - 3_600_000 });
    expect(stoppedByRestart([...together, alone], started, 12).map((s) => s.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("a session written since the machine started is running: never reopened", () => {
    const running = session({ endedCleanly: false, id: "running", lastWrite: started + 1000 });
    expect(stoppedByRestart([running], started, 12)).toEqual([]);
  });

  test("sessions that closed in the same moment since the start were closed with one window", () => {
    const a = session({ id: "a", lastWrite: started + 10_000 });
    const b = session({ id: "b", lastWrite: started + 12_000 });
    const laterAlone = session({ id: "c", lastWrite: started + 60_000 });
    expect(closedWithWindow([a, b, laterAlone], started).map((s) => s.id)).toEqual(["a", "b"]);
    expect(closedWithWindow([laterAlone], started)).toEqual([]);
  });

  test("sessionsToReopen leaves out the ones running now", () => {
    const stopped = session({ endedCleanly: false, id: "stopped", lastWrite: started - 1000 });
    const open = session({ endedCleanly: false, id: "open", lastWrite: started - 1000 });
    expect(
      sessionsToReopen([stopped, open], new Set(["open"]), started, 12).map((s) => s.id),
    ).toEqual(["stopped"]);
  });
});

describe("the sessions command", () => {
  /** A config folder with this project's saved sessions in it. */
  function world(
    files: { id: string; tail: string; writtenAt: number }[],
    options: {
      runningSessions?: { pid: number; sessionId: string; cwd: string; name: string }[];
    } = {},
  ) {
    const home = tempDir("sessions");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const project = "/work/my-app";
    const folder = join(paths.claudeConfigDir, "projects", projectFolderName(project));
    mkdirSync(folder, { recursive: true });
    for (const file of files) {
      writeFileSync(join(folder, `${file.id}.jsonl`), file.tail);
      const when = new Date(file.writtenAt);
      Bun.spawnSync(["touch", "-d", when.toISOString(), join(folder, `${file.id}.jsonl`)]);
    }
    if (options.runningSessions !== undefined) {
      const dir = join(paths.claudeConfigDir, "sessions");
      mkdirSync(dir, { recursive: true });
      for (const record of options.runningSessions) {
        writeFileSync(
          join(dir, `${String(record.pid)}.json`),
          JSON.stringify({ ...record, ...sessionProcessIdentity(record.pid) }),
        );
      }
    }
    return { home, paths, project, folder };
  }

  /** The command's own dependencies: no desktop, no terminals, nothing opened. */
  function deps(over: Partial<Parameters<typeof runSessions>[2]> = {}) {
    const opened: string[][] = [];
    return {
      opened,
      deps: {
        command: "cc-smart-dev-kit",
        now: 100 * 3_600_000,
        platform: "linux" as NodeJS.Platform,
        sleep: () => Promise.resolve(),
        spawnDetached: (argv: string[]) => {
          opened.push(argv);
          return { exited: Promise.resolve(0) };
        },
        uptimeSeconds: 3600,
        which: () => null,
        ...over,
      },
    };
  }

  test("it lists this project's sessions by name, worktree and state", async () => {
    const now = 100 * 3_600_000;
    const written = now - 60_000;
    const w = world([
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        tail: line({
          agentName: "Fix the login bug",
          cwd: "/work/my-app-wt-fix-login",
          type: "agent-name",
        }),
        writtenAt: written,
      },
      {
        id: "bbbbbbbb-1111-2222-3333-444444444444",
        tail: line({ type: "user" }),
        writtenAt: written,
      },
    ]);
    const out: string[] = [];
    const print = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(
        await runSessions(w.paths, { dryRun: false, open: false }, deps().deps, w.project),
      ).toBe(0);
    } finally {
      print.mockRestore();
    }
    const text = out.join("\n");
    expect(text).toContain("Claude sessions of this project, used in the last 48 hours");
    // A session Claude never titled is a one-shot run: not listed.
    expect(text).toContain("Fix the login bug — my-app-wt-fix-login");
    expect(text).toContain("claude --resume aaaaaaaa-1111-2222-3333-444444444444");
    expect(text).not.toContain("bbbbbbbb");
    expect(text).toContain("No supported terminal is installed here");
  });

  test("--open with no terminal says what it would open, and opens nothing", async () => {
    const now = 100 * 3_600_000;
    const startedAt = now - 3600 * 1000;
    const w = world([
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        tail: line({ agentName: "Fix the login bug", cwd: "/work/my-app", type: "agent-name" }),
        // Killed at the restart: not closed by Claude Code itself.
        writtenAt: startedAt - 1000,
      },
    ]);
    const { deps: fake, opened } = deps();
    const out: string[] = [];
    const print = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(await runSessions(w.paths, { dryRun: false, open: true }, fake, w.project)).toBe(0);
    } finally {
      print.mockRestore();
    }
    expect(out.join("\n")).toContain("Would open 1 session(s):");
    expect(out.join("\n")).toContain("STOPPED by the restart — not resumed yet");
    expect(opened).toEqual([]);
  });

  test("listing sessions leaves existing Warp tabs untouched", async () => {
    const now = 100 * 3_600_000;
    const w = world([
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        tail: line({ agentName: "Keep existing terminal tabs", type: "agent-name" }),
        writtenAt: now - 60_000,
      },
    ]);
    const dir = join(w.paths.home, ".local", "share", "warp-terminal", "tab_configs");
    mkdirSync(dir, { recursive: true });
    const old = '# Written by cc-smart-dev-kit `sessions`.\nname = "old"\n';
    writeFileSync(join(dir, "claude_gone.toml"), old);
    const probes: string[] = [];
    const { deps: fake } = deps({
      which: (name) => {
        probes.push(name);
        return null;
      },
    });
    const listing: string[] = [];
    const print = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      listing.push(args.join(" "));
    });
    try {
      expect(await runSessions(w.paths, { dryRun: false, open: false }, fake, w.project)).toBe(0);
    } finally {
      print.mockRestore();
    }
    expect(listing.join("\n")).toContain("Keep existing terminal tabs");
    expect(probes).toContain("xfce4-terminal");
    expect(readdirSync(dir)).toEqual(["claude_gone.toml"]);
    expect(readFileSync(join(dir, "claude_gone.toml"), "utf8")).toBe(old);
    expect(probes).not.toContain("warp-terminal");
  });

  test("a session already running is never opened again", async () => {
    const now = 100 * 3_600_000;
    const startedAt = now - 3600 * 1000;
    const id = "aaaaaaaa-1111-2222-3333-444444444444";
    const w = world(
      [
        {
          id,
          tail: line({ agentName: "Fix the login bug", cwd: "/work/my-app", type: "agent-name" }),
          writtenAt: startedAt - 1000,
        },
      ],
      { runningSessions: [{ cwd: "/work/my-app", name: "it", pid: process.pid, sessionId: id }] },
    );
    const { deps: fake, opened } = deps();
    const out: string[] = [];
    const print = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(await runSessions(w.paths, { dryRun: false, open: true }, fake, w.project)).toBe(0);
    } finally {
      print.mockRestore();
    }
    expect(out.join("\n")).toContain("open now");
    expect(out.join("\n")).toContain("Nothing to bring back");
    expect(opened).toEqual([]);
  });

  test("savedSessions reads only this project's folder, and only recent files", () => {
    const now = 100 * 3_600_000;
    const w = world([
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        tail: line({ agentName: "recent", type: "agent-name" }),
        writtenAt: now - 1000,
      },
    ]);
    // Another project's folder, and a very old file: neither is read.
    const other = join(w.paths.claudeConfigDir, "projects", "-work-another-project");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "cccccccc.jsonl"), line({ agentName: "other", type: "agent-name" }));
    expect(
      savedSessions(join(w.paths.claudeConfigDir, "projects"), w.project, now - 48 * 3_600_000).map(
        (read) => read.name,
      ),
    ).toEqual(["recent"]);
    // A session whose name is missing entirely (a one-shot run) is left out too.
    expect(existsSync(w.folder)).toBe(true);
  });

  test("a session in Claude Code's own worktree is this project's; a folder beside it is not", () => {
    const now = 100 * 3_600_000;
    const w = world([]);
    const projects = join(w.paths.claudeConfigDir, "projects");
    // `<repo>/.claude/worktrees/fix-login`: Claude Code's project folder for the worktree.
    const nested = join(projects, projectFolderName("/work/my-app/.claude/worktrees/fix-login"));
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "bbbbbbbb-1111-2222-3333-444444444444.jsonl"),
      line({ agentName: "nested", type: "agent-name" }),
    );
    // A folder beside the checkout: the retired engine made its worktrees there.
    const sibling = join(projects, projectFolderName("/work/app-wt-fix-login"));
    mkdirSync(sibling, { recursive: true });
    writeFileSync(
      join(sibling, "dddddddd-1111-2222-3333-444444444444.jsonl"),
      line({ agentName: "sibling", type: "agent-name" }),
    );
    const names = savedSessions(projects, w.project, now - 48 * 3_600_000)
      .map((read) => read.name)
      .sort();
    expect(names).toEqual(["nested"]);
  });

  test("a file whose name is not a session id is left out: the id goes into a shell command", () => {
    const now = 100 * 3_600_000;
    const w = world([
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        tail: line({ agentName: "real", type: "agent-name" }),
        writtenAt: now - 1000,
      },
      // A file name is not a promise about its content: `weird; rm -rf ~` is a title, but the
      // id would be pasted into `claude --resume <id>` in a terminal.
      {
        id: "weird;-rm-rf-~",
        tail: line({ agentName: "not a session", type: "agent-name" }),
        writtenAt: now - 1000,
      },
    ]);
    expect(
      savedSessions(join(w.paths.claudeConfigDir, "projects"), w.project, now - 48 * 3_600_000).map(
        (read) => read.id,
      ),
    ).toEqual(["aaaaaaaa-1111-2222-3333-444444444444"]);
  });

  test("--open twice in a row: the second run opens nothing, and says so", async () => {
    const now = 100 * 3_600_000;
    const startedAt = now - 3600 * 1000;
    const id = "aaaaaaaa-1111-2222-3333-444444444444";
    const w = world([
      {
        id,
        tail: line({ agentName: "Fix the login bug", cwd: "/work/my-app", type: "agent-name" }),
        // Killed at the restart: the first `--open` brings it back.
        writtenAt: startedAt - 1000,
      },
    ]);
    const { deps: fake, opened } = deps({
      which: (command) => (command === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null),
    });
    const out: string[] = [];
    const print = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(await runSessions(w.paths, { dryRun: false, open: true }, fake, w.project)).toBe(0);
      expect(opened).toHaveLength(1);
      // A resumed session has not written to its file yet, so it still looks stopped: the
      // marker `--open` wrote is what keeps the second run from opening a second copy.
      out.length = 0;
      expect(await runSessions(w.paths, { dryRun: false, open: true }, fake, w.project)).toBe(0);
    } finally {
      print.mockRestore();
    }
    expect(opened).toHaveLength(1);
    expect(out.join("\n")).toContain("Nothing to bring back");
    // The marker holds the time it was opened, and a dry run adds none.
    expect(readFileSync(openedMarkerFile(w.paths.stateDir, id), "utf8")).toBe(
      `${new Date(fake.now).toISOString()}\n`,
    );

    // After the window it is opened again — the session may really have died since.
    const later = deps({
      now: fake.now + (OPENED_AGAIN_MINUTES + 1) * 60_000,
      which: (command) => (command === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null),
    });
    const printAgain = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await runSessions(w.paths, { dryRun: false, open: true }, later.deps, w.project)).toBe(
        0,
      );
    } finally {
      printAgain.mockRestore();
    }
    expect(later.opened).toHaveLength(1);
  });

  test("the opened markers are short-lived: an old one goes when a new one is written", () => {
    const stateDir = tempDir("sessions-markers");
    const first = "aaaaaaaa-1111-2222-3333-444444444444";
    const second = "bbbbbbbb-1111-2222-3333-444444444444";
    const now = 100 * 3_600_000;
    markOpened(stateDir, first, now);
    expect(readFileSync(openedMarkerFile(stateDir, first), "utf8")).toBe(
      `${new Date(now).toISOString()}\n`,
    );
    markOpened(stateDir, second, now + (OPENED_AGAIN_MINUTES + 1) * 60_000);
    expect(existsSync(openedMarkerFile(stateDir, first))).toBe(false);
    expect(existsSync(openedMarkerFile(stateDir, second))).toBe(true);
  });

  test("--open marks nothing for a window that could not be opened", async () => {
    const now = 100 * 3_600_000;
    const startedAt = now - 3600 * 1000;
    const id = "aaaaaaaa-1111-2222-3333-444444444444";
    const w = world([
      {
        id,
        tail: line({ agentName: "Fix the login bug", cwd: "/work/my-app", type: "agent-name" }),
        writtenAt: startedAt - 1000,
      },
    ]);
    const { deps: fake, opened } = deps({
      // The window opens nothing: the command hands the window to the terminal and exits 1.
      spawnDetached: (argv: string[]) => {
        opened.push(argv);
        return { exited: Promise.resolve(1) };
      },
      which: (command) => (command === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null),
    });
    const print = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      // CM-11: a window that did not open is a failure of the command, and says so.
      expect(await runSessions(w.paths, { dryRun: false, open: true }, fake, w.project)).toBe(1);
    } finally {
      print.mockRestore();
    }
    expect(opened).toHaveLength(1);
    expect(existsSync(openedMarkerFile(w.paths.stateDir, id))).toBe(false);
  });

  test("CM-11: --open exits 1 when a window could not be opened, and 0 when every one did", async () => {
    const now = 100 * 3_600_000;
    const startedAt = now - 3600 * 1000;
    const w = world([
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        tail: line({ agentName: "One", cwd: "/work/my-app", type: "agent-name" }),
        writtenAt: startedAt - 1000,
      },
      {
        id: "bbbbbbbb-1111-2222-3333-444444444444",
        tail: line({ agentName: "Two", cwd: "/work/my-app", type: "agent-name" }),
        writtenAt: startedAt - 1000,
      },
    ]);
    const print = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      // The first window opens, the second does not: one failure is the command's failure,
      // so a script around it can tell that some session did not come back.
      const windows: string[][] = [];
      const someFail = deps({
        spawnDetached: (argv: string[]) => {
          windows.push(argv);
          return { exited: Promise.resolve(windows.length === 1 ? 0 : 1) };
        },
        which: (command) => (command === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null),
      });
      expect(
        await runSessions(w.paths, { dryRun: false, open: true }, someFail.deps, w.project),
      ).toBe(1);
      expect(windows).toHaveLength(2);
      const allOpen = deps({
        which: (command) => (command === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null),
      });
      expect(
        await runSessions(w.paths, { dryRun: false, open: true }, allOpen.deps, w.project),
      ).toBe(0);
    } finally {
      print.mockRestore();
    }
  });

  test("on Windows --open brings each session back in a Windows Terminal window", async () => {
    const now = 100 * 3_600_000;
    const startedAt = now - 3600 * 1000;
    const id = "aaaaaaaa-1111-2222-3333-444444444444";
    const w = world([
      {
        id,
        tail: line({ agentName: "Fix the login bug", cwd: "/work/my-app", type: "agent-name" }),
        // Killed at the restart: `--open` brings it back.
        writtenAt: startedAt - 1000,
      },
    ]);
    const { deps: fake, opened } = deps({
      platform: "win32",
      which: (command) => (command === "wt.exe" ? "C:\\Windows\\wt.exe" : null),
    });
    const out: string[] = [];
    const print = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.join(" "));
    });
    try {
      expect(await runSessions(w.paths, { dryRun: false, open: true }, fake, w.project)).toBe(0);
    } finally {
      print.mockRestore();
    }
    // No XFCE Terminal and no `systemd-run` on Windows: the window is started directly.
    expect(opened).toEqual([["wt.exe", "-d", w.project, "cmd", "/k", `claude --resume ${id}`]]);
    expect(out.join("\n")).toContain(
      "--open reopens the stopped ones, each in a Windows Terminal window of its own.",
    );
    expect(out.join("\n")).toContain(`Opened: Fix the login bug — my-app`);
  });
});
