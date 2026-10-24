/**
 * The crew archive (AR1): a removed crew session's conversation moves out of Claude Code's
 * projects folder into the kit's state, gzipped file by file, and is deleted after
 * `crew.archiveDays`. Every path is in a temp folder; no real Claude session runs.
 */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { cliPaths } from "../cli/paths";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { repoKey } from "../workflow/reviews";
import {
  ARCHIVE_MANIFEST,
  archiveConversation,
  archiveDaysOf,
  conversationOf,
  crewArchiveDir,
  DAY_MS,
  expiredArchives,
  pruneCrewArchives,
  sessionsNeverTaken,
  sourceAfterCopy,
} from "./archive";
import { crewArchiveRoot, transcriptBytes, transcriptTree } from "./archive-read";
import type { CrewRecord } from "./store";
import { createCrew, writeLead } from "./store";

const NOW = Date.parse("2026-10-25T10:00:00.000Z");
const SESSION = "a1b2c3d4-0000-1111-2222-333333333333";
const LEAD = "c00f9bb5-1111-2222-3333-444444444444";
const OTHER = "e22e0000-1111-2222-3333-444444444444";

function world() {
  const home = tempDir("archive");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  const repo = join(home, "code", "my-app");
  const worktree = join(repo, ".claude", "worktrees", "crew-B1-help");
  const project = join(paths.projectsDir, worktree.replace(/[^A-Za-z0-9]/g, "-"));
  const record = (over: Partial<CrewRecord> = {}): CrewRecord => ({
    base: null,
    baseRef: "main",
    branch: "crew/B1-help",
    createdAt: "2026-10-25T08:00:00.000Z",
    effort: "high",
    files: [],
    id: "B1-help-1a2b3c",
    kind: "build",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
    name: "C my-app B1 help",
    permissionMode: "auto",
    phase: "B1",
    plan: "master-plan",
    pr: null,
    questions: [],
    repo,
    reportPath: null,
    sessionId: SESSION,
    shortId: "a1b2c3d4",
    slug: "help",
    state: "removed",
    updatedAt: "2026-10-25T09:00:00.000Z",
    version: 1,
    waitsFor: [],
    worktree,
    ...over,
  });
  /** Writes one file of Claude Code's layout under the project folder, with its time. */
  const write = (relative: string, text: string, atMs = NOW - 60_000) => {
    const file = join(project, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    utimesSync(file, atMs / 1000, atMs / 1000);
    return file;
  };
  const conversation = () => {
    write(`${SESSION}.jsonl`, '{"type":"user"}\n{"type":"assistant"}\n');
    write(`${SESSION}/subagents/agent-1.jsonl`, '{"type":"assistant","isSidechain":true}\n');
    write(`${SESSION}/subagents/agent-1.meta.json`, '{"model":"haiku"}');
    write(`${SESSION}/tool-results/out-1.txt`, "tool output\n");
  };
  const input = (over: Partial<Parameters<typeof archiveConversation>[0]> = {}) => ({
    neverTaken: new Set<string>(),
    nowMs: NOW,
    paths,
    record: record(),
    running: new Set<string>(),
    ...over,
  });
  return { conversation, home, input, paths, project, record, repo, worktree, write };
}

/** Holds the archive lock as another run would; the returned function lets it go. */
async function holdArchiveLock(stateDir: string): Promise<() => void> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  void withLock(
    crewArchiveRoot(stateDir),
    async () => {
      ready();
      await held;
    },
    { waitMs: 1000 },
  );
  await started;
  return release;
}

const gunzipped = (file: string) => gunzipSync(readFileSync(file)).toString("utf8");

describe("archiveConversation", () => {
  test("moves the transcript, its folder and the empty project folder, gzipped, keeping each file's time", async () => {
    const w = world();
    w.conversation();
    const report = join(w.home, "report.json");
    writeFileSync(report, '{"status":"done"}\n');

    const outcome = await archiveConversation(
      w.input({ record: w.record({ reportPath: report }) }),
    );

    const dir = join(w.paths.stateDir, "crew-archive", repoKey(w.repo), "B1-help-1a2b3c");
    expect(outcome).toEqual({ dir, files: 4, folderGone: true, kind: "archived" });
    expect(existsSync(w.project)).toBe(false);
    const into = join(dir, "projects", w.project.split("/").at(-1) ?? "");
    expect(gunzipped(join(into, `${SESSION}.jsonl.gz`))).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n',
    );
    expect(gunzipped(join(into, SESSION, "subagents", "agent-1.jsonl.gz"))).toBe(
      '{"type":"assistant","isSidechain":true}\n',
    );
    expect(gunzipped(join(into, SESSION, "subagents", "agent-1.meta.json.gz"))).toBe(
      '{"model":"haiku"}',
    );
    expect(gunzipped(join(into, SESSION, "tool-results", "out-1.txt.gz"))).toBe("tool output\n");
    expect(statSync(join(into, `${SESSION}.jsonl.gz`)).mtimeMs).toBe(NOW - 60_000);
    expect(JSON.parse(readFileSync(join(dir, ARCHIVE_MANIFEST), "utf8"))).toEqual({
      archivedAt: "2026-10-25T10:00:00.000Z",
      crew: "B1-help-1a2b3c",
      name: "C my-app B1 help",
      projectFolder: w.project.split("/").at(-1),
      repo: w.repo,
      sessionId: SESSION,
      version: 1,
    });
    expect(readFileSync(join(dir, "report.json"), "utf8")).toBe('{"status":"done"}\n');
    // The kit's own state: only the person reads it.
    expect(statSync(join(into, `${SESSION}.jsonl.gz`)).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("another session in the same project folder stays, and so does the folder", async () => {
    const w = world();
    w.conversation();
    const other = w.write(`${OTHER}.jsonl`, '{"type":"user"}\n');

    const outcome = await archiveConversation(w.input());

    expect(outcome).toMatchObject({ files: 4, folderGone: false, kind: "archived" });
    expect(readdirSync(w.project)).toEqual([`${OTHER}.jsonl`]);
    expect(readFileSync(other, "utf8")).toBe('{"type":"user"}\n');
  });

  test("the empty memory folder Claude Code leaves in a project folder goes with it; a file in it keeps the folder", async () => {
    const w = world();
    w.conversation();
    mkdirSync(join(w.project, "memory"));
    expect(await archiveConversation(w.input())).toMatchObject({
      folderGone: true,
      kind: "archived",
    });
    expect(existsSync(w.project)).toBe(false);

    // The same with nothing to move at all: the folder holds only that empty folder.
    mkdirSync(join(w.project, "memory"), { recursive: true });
    expect(await archiveConversation(w.input())).toEqual({ folderGone: true, kind: "nothing" });
    expect(existsSync(w.project)).toBe(false);

    // A note Claude Code wrote there is not ours to delete: the folder stays with it.
    const note = w.write("memory/MEMORY.md", "a note\n");
    w.conversation();
    expect(await archiveConversation(w.input())).toMatchObject({
      folderGone: false,
      kind: "archived",
    });
    expect(readFileSync(note, "utf8")).toBe("a note\n");
  });

  test("a lead's session, or one a running Claude holds, is never touched", async () => {
    const w = world();
    w.conversation();
    expect(await archiveConversation(w.input({ neverTaken: new Set([SESSION]) }))).toEqual({
      kind: "kept",
      why: "a lead, or a crew session still on the board, holds that session",
    });
    expect(await archiveConversation(w.input({ running: new Set([SESSION]) }))).toEqual({
      kind: "kept",
      why: "a running Claude session holds it",
    });
    expect(existsSync(join(w.project, `${SESSION}.jsonl`))).toBe(true);
    expect(existsSync(crewArchiveRoot(w.paths.stateDir))).toBe(false);
  });

  test("a link in the session's folder is not followed or moved, and keeps its folder", async () => {
    const w = world();
    w.conversation();
    const outside = join(w.home, "outside.txt");
    writeFileSync(outside, "the person's\n");
    symlinkSync(outside, join(w.project, SESSION, "link.txt"));

    const outcome = await archiveConversation(w.input());

    expect(outcome).toMatchObject({ files: 4, folderGone: false, kind: "archived" });
    expect(readdirSync(join(w.project, SESSION))).toEqual(["link.txt"]);
    expect(readFileSync(outside, "utf8")).toBe("the person's\n");
  });

  test("nothing there: nothing moves, and an empty project folder goes", async () => {
    const w = world();
    mkdirSync(w.project, { recursive: true });
    expect(await archiveConversation(w.input())).toEqual({ folderGone: true, kind: "nothing" });
    expect(existsSync(w.project)).toBe(false);
    expect(await archiveConversation(w.input({ record: w.record({ sessionId: null }) }))).toEqual({
      folderGone: false,
      kind: "nothing",
    });
  });

  test("a move that stopped before the delete is finished: the same bytes, archived and still there", async () => {
    const w = world();
    w.conversation();
    const first = await archiveConversation(w.input());
    expect(first.kind).toBe("archived");
    // The delete of the original never happened: the same file is back beside its archived copy.
    w.write(`${SESSION}.jsonl`, '{"type":"user"}\n{"type":"assistant"}\n');

    const second = await archiveConversation(w.input({ nowMs: NOW + 60_000 }));

    expect(second).toMatchObject({ files: 1, folderGone: true, kind: "archived" });
    expect(existsSync(w.project)).toBe(false);
    const dir = crewArchiveDir(w.paths.stateDir, w.repo, "B1-help-1a2b3c");
    // Finishing a move does not make the archive younger: it began at the first run.
    expect(JSON.parse(readFileSync(join(dir, ARCHIVE_MANIFEST), "utf8")).archivedAt).toBe(
      "2026-10-25T10:00:00.000Z",
    );
    const into = join(dir, "projects", w.project.split("/").at(-1) ?? "");
    expect(gunzipped(join(into, `${SESSION}.jsonl.gz`))).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n',
    );
  });

  test("a file that appeared again with other content never replaces the archived copy", async () => {
    const w = world();
    w.conversation();
    await archiveConversation(w.input());
    // Something wrote the conversation again after the move (a job that kept running): a new file.
    const again = w.write(
      `${SESSION}.jsonl`,
      '{"type":"user"}\n{"type":"assistant"}\n{"type":"late"}\n',
    );

    // Another file of the session is there too: nothing moves while one of them differs.
    const other = w.write(`${SESSION}/subagents/agent-2.jsonl`, '{"type":"assistant"}\n');

    const second = await archiveConversation(w.input({ nowMs: NOW + 60_000 }));

    expect(second).toEqual({
      kind: "kept",
      why: `${SESSION}.jsonl differs from its archived copy, so neither is overwritten`,
    });
    expect(readFileSync(again, "utf8")).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n{"type":"late"}\n',
    );
    expect(readFileSync(other, "utf8")).toBe('{"type":"assistant"}\n');
    const dir = crewArchiveDir(w.paths.stateDir, w.repo, "B1-help-1a2b3c");
    const into = join(dir, "projects", w.project.split("/").at(-1) ?? "");
    expect(gunzipped(join(into, `${SESSION}.jsonl.gz`))).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n',
    );
    // The archive keeps the day it began: a later try does not make it younger.
    expect(JSON.parse(readFileSync(join(dir, ARCHIVE_MANIFEST), "utf8")).archivedAt).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });

  test("a session folder that is itself a link is not followed: nothing under its target moves", async () => {
    const w = world();
    w.write(`${SESSION}.jsonl`, '{"type":"user"}\n');
    const target = join(w.home, "someone-elses-folder");
    mkdirSync(join(target, "empty"), { recursive: true });
    writeFileSync(join(target, "notes.txt"), "the person's own notes\n");
    symlinkSync(target, join(w.project, SESSION));

    const outcome = await archiveConversation(w.input());

    expect(outcome).toMatchObject({ files: 1, folderGone: false, kind: "archived" });
    expect(readFileSync(join(target, "notes.txt"), "utf8")).toBe("the person's own notes\n");
    // Not even the empty folder in it was taken, and the link stays where it was.
    expect(existsSync(join(target, "empty"))).toBe(true);
    expect(readdirSync(w.project)).toEqual([SESSION]);
  });

  test("two archives of one record at once end with every file in the archive, once", async () => {
    const w = world();
    w.conversation();

    const outcomes = await Promise.all([
      archiveConversation(w.input()),
      archiveConversation(w.input()),
    ]);

    expect(outcomes.map((one) => one.kind).sort()).toEqual(["archived", "nothing"]);
    expect(existsSync(w.project)).toBe(false);
    const dir = crewArchiveDir(w.paths.stateDir, w.repo, "B1-help-1a2b3c");
    const into = join(dir, "projects", w.project.split("/").at(-1) ?? "");
    expect(gunzipped(join(into, `${SESSION}.jsonl.gz`))).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n',
    );
    expect(gunzipped(join(into, SESSION, "tool-results", "out-1.txt.gz"))).toBe("tool output\n");
    expect(readdirSync(join(into, SESSION, "subagents")).sort()).toEqual([
      "agent-1.jsonl.gz",
      "agent-1.meta.json.gz",
    ]);
  });

  test("an archive another run holds waits its turn, and says so when the wait ends", async () => {
    const w = world();
    w.conversation();
    const release = await holdArchiveLock(w.paths.stateDir);
    try {
      const outcome = await archiveConversation(w.input({ lockWaitMs: 0 }));
      expect(outcome.kind).toBe("failed");
      expect(outcome).toMatchObject({ moved: 0 });
      expect(existsSync(join(w.project, `${SESSION}.jsonl`))).toBe(true);
    } finally {
      release();
    }
    // Once the other run is done, the same call moves it.
    expect(await archiveConversation(w.input())).toMatchObject({ kind: "archived" });
  });

  test("a source that is gone after its copy was made keeps the copy; one that changed loses it", () => {
    const before = { mtimeMs: 1000, size: 10 };
    expect(sourceAfterCopy(undefined, before)).toBe("gone");
    expect(sourceAfterCopy({ mtimeMs: 1000, size: 10 }, before)).toBe("same");
    expect(sourceAfterCopy({ mtimeMs: 2000, size: 10 }, before)).toBe("changed");
    expect(sourceAfterCopy({ mtimeMs: 1000, size: 11 }, before)).toBe("changed");
  });

  test("an archive folder it cannot make: it fails, and the files stay", async () => {
    const w = world();
    w.conversation();
    // A file where the archive's folder must go: the move cannot start.
    mkdirSync(join(w.paths.stateDir, "crew-archive", repoKey(w.repo)), { recursive: true });
    writeFileSync(join(w.paths.stateDir, "crew-archive", repoKey(w.repo), "B1-help-1a2b3c"), "x");

    const outcome = await archiveConversation(w.input());

    expect(outcome).toMatchObject({ kind: "failed", moved: 0 });
    expect(existsSync(join(w.project, `${SESSION}.jsonl`))).toBe(true);
    expect(existsSync(join(w.project, SESSION, "subagents", "agent-1.jsonl"))).toBe(true);
  });

  test("conversationOf names the session's folder first and its own transcript last", () => {
    const w = world();
    w.conversation();
    expect(conversationOf(w.paths.projectsDir, w.worktree, SESSION)).toEqual({
      files: [
        `${SESSION}/subagents/agent-1.jsonl`,
        `${SESSION}/subagents/agent-1.meta.json`,
        `${SESSION}/tool-results/out-1.txt`,
        `${SESSION}.jsonl`,
      ],
      projectDir: w.project,
    });
  });
});

describe("sessionsNeverTaken", () => {
  test("every lead's session, and the session of each crew record still on the board", async () => {
    const w = world();
    await writeLead(
      w.paths.stateDir,
      {
        cwd: w.repo,
        name: "LEAD my-app other",
        plan: "other",
        repo: w.repo,
        sessionId: OTHER,
        tag: "my-app",
      },
      NOW,
    );
    const { createdAt: _c, updatedAt: _u, version: _v, ...removed } = w.record();
    await createCrew(w.paths.stateDir, removed, NOW);
    await createCrew(
      w.paths.stateDir,
      {
        ...removed,
        id: "B2-work-1a2b3c",
        sessionId: "b2b2b2b2-0000-1111-2222-333333333333",
        state: "working",
      },
      NOW,
    );
    expect([...sessionsNeverTaken(w.paths.stateDir, null)].sort()).toEqual(
      ["b2b2b2b2-0000-1111-2222-333333333333", LEAD, OTHER].sort(),
    );
    // The record being removed is not kept back by its own state.
    expect(sessionsNeverTaken(w.paths.stateDir, "B2-work-1a2b3c").has(SESSION)).toBe(false);
    expect(
      sessionsNeverTaken(w.paths.stateDir, "B2-work-1a2b3c").has(
        "b2b2b2b2-0000-1111-2222-333333333333",
      ),
    ).toBe(false);
  });

  test("a record it cannot read: it throws, so nothing is taken", () => {
    const w = world();
    const broken = join(w.paths.stateDir, "crew", repoKey(w.repo), "leads", `${LEAD}.json`);
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(broken, "{");
    expect(() => sessionsNeverTaken(w.paths.stateDir, null)).toThrow(
      "a crew or lead record of the store cannot be read",
    );
  });
});

describe("pruneCrewArchives", () => {
  /** An archive whose `archive.json` says it was archived `ageMs` ago. */
  function archived(w: ReturnType<typeof world>, crew: string, ageMs: number, repo = w.repo) {
    const dir = crewArchiveDir(w.paths.stateDir, repo, crew);
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(
      join(dir, ARCHIVE_MANIFEST),
      JSON.stringify({
        archivedAt: new Date(NOW - ageMs).toISOString(),
        crew,
        name: `C my-app ${crew}`,
        projectFolder: "-x",
        repo,
        sessionId: SESSION,
        version: 1,
      }),
    );
    return dir;
  }

  test("an archive goes after its days, and not before", async () => {
    const w = world();
    const young = archived(w, "young", 7 * DAY_MS - 60_000);
    const old = archived(w, "old", 7 * DAY_MS + 60_000);

    const outcome = await pruneCrewArchives(w.paths.stateDir, () => 7, NOW);

    expect(outcome).toEqual({
      kept: [],
      pruned: [{ ageMs: 7 * DAY_MS + 60_000, dir: old, name: "C my-app old" }],
    });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  test("each repository's own days; a look deletes nothing; an empty repository folder goes", async () => {
    const w = world();
    const other = join(w.home, "code", "other-app");
    const mine = archived(w, "mine", 4 * DAY_MS);
    const theirs = archived(w, "theirs", 4 * DAY_MS, other);
    const days = (repo: null | string) => (repo === other ? 3 : 7);

    expect(expiredArchives(w.paths.stateDir, days, NOW).pruned.map((one) => one.dir)).toEqual([
      theirs,
    ]);
    expect(existsSync(theirs)).toBe(true);

    await pruneCrewArchives(w.paths.stateDir, days, NOW);
    expect(existsSync(theirs)).toBe(false);
    expect(existsSync(dirname(theirs))).toBe(false);
    expect(existsSync(mine)).toBe(true);
  });

  test("days it cannot read keep the archive; an archive with no archive.json counts from its folder's time", async () => {
    const w = world();
    const kept = archived(w, "kept", 30 * DAY_MS);
    const nameless = crewArchiveDir(w.paths.stateDir, w.repo, "nameless");
    mkdirSync(nameless, { recursive: true });
    utimesSync(nameless, (NOW - 8 * DAY_MS) / 1000, (NOW - 8 * DAY_MS) / 1000);

    const outcome = await pruneCrewArchives(
      w.paths.stateDir,
      (repo) => (repo === null ? 7 : null),
      NOW,
    );

    expect(outcome.kept).toEqual([
      { dir: kept, why: "its repository's crew.archiveDays cannot be read" },
    ]);
    expect(outcome.pruned.map((one) => one.name)).toEqual(["nameless"]);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(nameless)).toBe(false);
  });

  test("an archive whose repository folder is gone expires by the person's own days, not never", async () => {
    const w = world();
    const gone = join(w.home, "code", "moved-away-app");
    const old = archived(w, "old", 8 * DAY_MS, gone);
    const young = archived(w, "young", 6 * DAY_MS, gone);
    const days = archiveDaysOf(w.paths, {});

    expect(days(gone)).toBe(7);
    expect(days(null)).toBe(7);
    await pruneCrewArchives(w.paths.stateDir, days, NOW);

    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  test("a folder that is not a git project still reads the person's days", () => {
    const w = world();
    mkdirSync(w.repo, { recursive: true });
    expect(archiveDaysOf(w.paths, {})(w.repo)).toBe(7);
  });

  test("an archive folder that vanishes while the prune runs does not stop it", async () => {
    const w = world();
    const nameless = crewArchiveDir(w.paths.stateDir, w.repo, "nameless");
    mkdirSync(nameless, { recursive: true });
    const outcome = await pruneCrewArchives(
      w.paths.stateDir,
      (repo) => {
        // The first look at its days is the moment another run deletes the folder.
        rmSync(nameless, { force: true, recursive: true });
        return repo === null ? 7 : null;
      },
      NOW,
    );
    expect(outcome).toEqual({ kept: [], pruned: [] });
  });

  test("the prune and an archive take turns", async () => {
    const w = world();
    archived(w, "old", 8 * DAY_MS);
    const release = await holdArchiveLock(w.paths.stateDir);
    try {
      await expect(
        pruneCrewArchives(w.paths.stateDir, () => 7, NOW, { lockWaitMs: 0 }),
      ).rejects.toThrow("is busy");
    } finally {
      release();
    }
    expect((await pruneCrewArchives(w.paths.stateDir, () => 7, NOW)).pruned).toHaveLength(1);
  });
});

describe("transcriptTree", () => {
  test("reads the projects folder and the archive as one tree; a file still in projects wins", async () => {
    const w = world();
    w.conversation();
    await archiveConversation(w.input());
    // The person's own session, in their own folder.
    const own = join(w.paths.projectsDir, "-home-user-code-my-app", `${OTHER}.jsonl`);
    mkdirSync(dirname(own), { recursive: true });
    writeFileSync(own, '{"type":"user"}\n');

    const tree = transcriptTree(w.paths.projectsDir, w.paths.stateDir);
    const folder = w.project.split("/").at(-1) ?? "";

    expect([...tree.keys()].sort()).toEqual(["-home-user-code-my-app", folder].sort());
    const archived = tree.get(folder)?.get(SESSION);
    expect(archived?.main?.gz).toBe(true);
    expect([...(archived?.subagents.keys() ?? [])]).toEqual(["agent-1.jsonl", "agent-1.meta.json"]);
    expect(transcriptBytes(archived?.main ?? { gz: false, path: "" })?.toString()).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n',
    );
    expect(tree.get("-home-user-code-my-app")?.get(OTHER)?.main).toEqual({ gz: false, path: own });
    // Without the state folder, the archive is not read.
    expect(transcriptTree(w.paths.projectsDir, null).has(folder)).toBe(false);

    // A copy of the transcript back in projects (a move that stopped halfway): it is read from there.
    const back = w.write(`${SESSION}.jsonl`, '{"type":"user"}\n');
    const subagent = w.write(`${SESSION}/subagents/agent-1.jsonl`, '{"type":"assistant"}\n');
    const again = transcriptTree(w.paths.projectsDir, w.paths.stateDir).get(folder)?.get(SESSION);
    expect(again?.main).toEqual({ gz: false, path: back });
    expect(again?.subagents.get("agent-1.jsonl")).toEqual({ gz: false, path: subagent });
    expect(again?.subagents.get("agent-1.meta.json")?.gz).toBe(true);
  });
});
