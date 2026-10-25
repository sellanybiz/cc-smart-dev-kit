/** The main-folder guard and the message guard. */
import { describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { createCrew, crewFile, writeStoreFile } from "../crew/store";
import { locateCheckout } from "../project/resolve";
import {
  hookEnv,
  makeRepo,
  runHook,
  wireProjectHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { editsMainFolder, mainFolderRefusal } from "./main-folder-guard";
import { messageLeavesRepo } from "./message-guard";
import { mainFolderGuardHook, messageGuardHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

function deny(reason: string) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  };
}

describe("editsMainFolder", () => {
  test.each([
    ["/code/app/src/a.ts", true],
    ["/code/app", true],
    ["/code/app/.claude/worktrees/x/src/a.ts", false], // a worktree inside the main checkout
    ["/code/app-wt-x/src/a.ts", false], // a worktree beside it
    ["/code/other/a.ts", false],
    ["/code/app/../app-wt-x/a.ts", false],
  ])("%j: %j", (file, expected) => {
    expect(
      editsMainFolder(file, "/code/app", ["/code/app/.claude/worktrees/x", "/code/app-wt-x"]),
    ).toBe(expected);
  });
});

describe("the main-folder guard", () => {
  function guarded(guardMainFolder = true) {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder },
    });
    const worktree = join(repo, "..", "app-wt-fix");
    git(repo, "worktree", "add", "-q", "-b", "fix", worktree);
    return { repo, worktree };
  }

  const edit = (cwd: string, file: string, tool = "Edit") => ({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: tool,
    tool_input: tool === "NotebookEdit" ? { notebook_path: file } : { file_path: file },
  });

  test("an edit in the main checkout is denied, with the way into a worktree", async () => {
    const { repo, worktree } = guarded();
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(repo, "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    expect(mainFolderRefusal("/code/app")).toBe(
      [
        "This file is in the main checkout (/code/app). This project makes every change in a worktree (cc-smart-dev-kit.json `worktrees.guardMainFolder`).",
        "Already working in a worktree? Edit the same file under that worktree's folder.",
        "Not in one yet: `EnterWorktree` with the task name as its `name` makes one, or resumes an existing one — use dashes, since a `/` becomes `+`.",
      ].join("\n"),
    );
  });

  test.each(["Write", "NotebookEdit"])("%s too", async (tool) => {
    const { repo } = guarded();
    const result = await runHook(
      mainFolderGuardHook,
      edit(repo, join(repo, "n.ipynb"), tool),
      hookEnv(),
    );
    expect(result.stdout).toContain('"permissionDecision":"deny"');
  });

  test("an edit in a worktree, and one outside the repo, pass", async () => {
    const { worktree } = guarded();
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(worktree, "a.ts")), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(tempDir("x"), "a.ts")), hookEnv()),
    ).toEqual({});
  });

  test("off unless the project turns it on", async () => {
    const { repo } = guarded(false);
    expect(await runHook(mainFolderGuardHook, edit(repo, join(repo, "a.ts")), hookEnv())).toEqual(
      {},
    );
    const plain = makeRepo();
    expect(await runHook(mainFolderGuardHook, edit(plain, join(plain, "a.ts")), hookEnv())).toEqual(
      {},
    );
  });

  test("cc-smart-dev-kit.json lists it in ownHooks (the project runs its own copy): silent", async () => {
    const { repo } = guarded();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
      ownHooks: ["main-folder-guard"],
    });
    wireProjectHook(repo, "PreToolUse", "Edit|Write|NotebookEdit");
    expect(await runHook(mainFolderGuardHook, edit(repo, join(repo, "a.ts")), hookEnv())).toEqual(
      {},
    );
  });

  test("a retired hook name in ownHooks (serena-root): the file still reads, and the guard still denies", async () => {
    // Refused by the strict parse, this name would make the guard ASK about every edit in the
    // repo ("cannot check"); it is accepted and silences nothing.
    const { repo, worktree } = guarded();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
      ownHooks: ["serena-root"],
    });
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(repo, "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
  });

  test("cc-smart-dev-kit.json needs a newer plugin: it asks before an edit in the repo, not outside", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99" });
    const inside = await runHook(mainFolderGuardHook, edit(repo, join(repo, "a.ts")), hookEnv());
    expect(inside.stdout).toContain('"permissionDecision":"ask"');
    expect(inside.stdout).toContain(
      "cc-smart-dev-kit cannot check whether this edit belongs in a worktree",
    );
    expect(inside.stdout).toContain("run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit");
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(tempDir("x"), "a.ts")), hookEnv()),
    ).toEqual({});
  });

  test("an edit through a symlinked path is still an edit of the main checkout", async () => {
    const { repo, worktree } = guarded();
    const link = join(tempDir("link"), "app");
    symlinkSync(repo, link);
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(link, "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    // A file that does not exist yet, in a folder reached through the link, is in it too.
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(link, "new", "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    // A symlinked worktree is not the main checkout.
    const wtLink = join(tempDir("link-wt"), "app-wt-fix");
    symlinkSync(worktree, wtLink);
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(wtLink, "a.ts")), hookEnv()),
    ).toEqual({});
  });
});

describe("the message guard", () => {
  const send = (cwd: string, to: string) => ({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: "SendMessage",
    tool_input: { to, message: "hi" },
  });

  test("messageLeavesRepo: only when every session of that name works outside", () => {
    const sessions = [
      { pid: 1, sessionId: "a", cwd: "/code/app-wt-x", name: "ours" },
      { pid: 2, sessionId: "b", cwd: "/elsewhere/other", name: "theirs" },
      { pid: 3, sessionId: "c", cwd: "/elsewhere/two", name: "twice" },
      { pid: 4, sessionId: "d", cwd: "/code/app", name: "twice" },
    ];
    const folders = ["/code/app", "/code/app-wt-x"];
    expect(messageLeavesRepo("ours", sessions, folders)).toBeNull();
    expect(messageLeavesRepo("theirs [ab12]", sessions, folders)).toBe("/elsewhere/other");
    expect(messageLeavesRepo("twice", sessions, folders)).toBeNull();
    expect(messageLeavesRepo("unknown", sessions, folders)).toBeNull();
  });

  test("a message to a session of another project is denied, naming its folder", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const elsewhere = tempDir("elsewhere");
    writeSessionRecord(env, { sessionId: "x", cwd: elsewhere, name: "other project" });
    expect(await runHook(messageGuardHook, send(repo, "other project"), env)).toEqual(
      deny(
        [
          `"other project" works in ${elsewhere}, outside this repo: sessions message only sessions of their own repo.`,
          "ListAgents lists every Claude session on the machine, other projects too.",
        ].join("\n"),
      ),
    );
  });

  test("a session of this repo, an unknown name, or no cc-smart-dev-kit.json: through", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    writeSessionRecord(env, { sessionId: "x", cwd: join(repo, "src"), name: "ours" });
    expect(await runHook(messageGuardHook, send(repo, "ours"), env)).toEqual({});
    expect(await runHook(messageGuardHook, send(repo, "nobody"), env)).toEqual({});
    const plain = makeRepo("plain");
    const env2 = hookEnv();
    writeSessionRecord(env2, { sessionId: "x", cwd: tempDir("e"), name: "other" });
    expect(await runHook(messageGuardHook, send(plain, "other"), env2)).toEqual({});
  });

  test("a running session's record that cannot be read: through (fails open)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const dir = join(env.CLAUDE_CONFIG_DIR ?? "", "sessions");
    Bun.spawnSync(["mkdir", "-p", dir]);
    await Bun.write(join(dir, `${process.pid}.json`), "{ broken");
    expect(await runHook(messageGuardHook, send(repo, "anyone"), env)).toEqual({});
  });

  test("a session reached through a symlink is still in this repo (no refusal)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const link = join(tempDir("link"), "app");
    symlinkSync(repo, link);
    writeSessionRecord(env, { sessionId: "x", cwd: join(link, "src"), name: "through-a-link" });
    expect(await runHook(messageGuardHook, send(repo, "through-a-link"), env)).toEqual({});
  });

  test("another project reached through a symlink is still refused", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const elsewhere = tempDir("elsewhere");
    const link = join(tempDir("link-elsewhere"), "other");
    symlinkSync(elsewhere, link);
    writeSessionRecord(env, { sessionId: "x", cwd: join(link, "src"), name: "other project" });
    const result = await runHook(messageGuardHook, send(repo, "other project"), env);
    expect(result.stdout).toContain('"permissionDecision":"deny"');
    // The refusal names the folder as the session record has it (what ListAgents shows).
    expect(result.stdout).toContain(`works in ${join(link, "src")}`);
  });
});

/**
 * The store of a repo's crew sessions, in the hook's own state folder: two crew sessions of one
 * lead, and the environment a crew session's hooks run with (`CREW_ENV`).
 */
async function crewStore(
  env: Record<string, string>,
  repo: string,
  records: { id: string; name: string; phase: string }[],
): Promise<{
  send: (to: string, message: string) => Promise<{ stdout?: string }>;
  env: Record<string, string>;
}> {
  const paths = cliPaths(env);
  const root = locateCheckout(repo)?.root ?? repo;
  for (const one of records) {
    await createCrew(
      paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: `crew/${one.phase}-${one.id}`,
        effort: "high",
        files: [],
        id: one.id,
        kind: "build",
        lastLine: null,
        leadName: "LEAD app lead",
        leadSessionId: "c00f9bb5-1111-2222-3333-444444444444",
        memoryMb: null,
        model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
        name: one.name,
        permissionMode: "auto",
        phase: one.phase,
        plan: "lead",
        pr: null,
        questions: [],
        repo: root,
        reportPath: null,
        sessionId: null,
        shortId: null,
        slug: one.id,
        state: "working",
        waitsFor: [],
        worktree: join(repo, ".claude", "worktrees", one.id),
      },
      Date.parse("2026-10-21T10:00:00.000Z"),
    );
  }
  // The sender is the first crew session: its own session's hooks carry its id.
  return {
    env: { ...env, CC_SMART_DEV_KIT_CREW: records[0]?.id ?? "" },
    send: (to, message) =>
      runHook(
        messageGuardHook,
        {
          cwd: repo,
          hook_event_name: "PreToolUse",
          session_id: "aaaa1111-2222-3333-4444-555555555555",
          tool_input: { message, to },
          tool_name: "SendMessage",
        },
        { ...env, CC_SMART_DEV_KIT_CREW: records[0]?.id ?? "" },
      ),
  };
}

describe("the message guard: crew sessions talk in contract notes (D47)", () => {
  const SELF = { id: "B1-lookup-1a2b3c", name: "C app B1 lookup", phase: "B1" };
  const PEER = { id: "B2-api-4d5e6f", name: "C app B2 api", phase: "B2" };

  test("an untagged message to another crew session is refused, naming crew tell", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const crew = await crewStore(hookEnv(), repo, [SELF, PEER]);
    expect(await crew.send(PEER.name, "done!")).toEqual(
      deny(
        [
          '"C app B2 api" is a crew session too, and one crew session messages another only with a contract note or a contract question.',
          'Fix: cc-smart-dev-kit crew tell "C app B2 api" --kind contract "<what changed: file:symbol, commit>", or --kind question "<the ask>"',
          'It writes the first line the note must carry ("[B1] CONTRACT: …"), and records the note for your lead.',
          "That the phase is done, or how it goes, goes to the lead: cc-smart-dev-kit crew report --status done --file - (with the JSON part).",
        ].join("\n"),
      ),
    );
  });

  test("1.1.2: an old-shape and a new-shape crew name are both another crew session", async () => {
    // A record written by 1.1.1 keeps `C <tag> <phase> <slug>`, its hand-off number included;
    // one started after 1.1.2 is `C <tag> <plan> <phase> <slug>`. The guard reads the store,
    // never the name's parts, so both are refused the same way.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const peers = [
      { id: "B2-api-4d5e6f", name: "C app B2 api", phase: "B2" },
      { id: "B2-api-4d5e70", name: "C app B2 api 2", phase: "B2" },
      { id: "B3-docs-7a8b9c", name: "C app master-plan B3 docs", phase: "B3" },
    ];
    const crew = await crewStore(hookEnv(), repo, [SELF, ...peers]);
    for (const peer of peers) {
      expect([peer.name, await crew.send(peer.name, "done!")]).toEqual([
        peer.name,
        deny(
          [
            `"${peer.name}" is a crew session too, and one crew session messages another only with a contract note or a contract question.`,
            `Fix: cc-smart-dev-kit crew tell "${peer.name}" --kind contract "<what changed: file:symbol, commit>", or --kind question "<the ask>"`,
            'It writes the first line the note must carry ("[B1] CONTRACT: …"), and records the note for your lead.',
            "That the phase is done, or how it goes, goes to the lead: cc-smart-dev-kit crew report --status done --file - (with the JSON part).",
          ].join("\n"),
        ),
      ]);
    }
  });

  test("a message with the sender's own tag goes through, of either kind", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const crew = await crewStore(hookEnv(), repo, [SELF, PEER]);
    expect(
      await crew.send(PEER.name, "[B1] CONTRACT: x.ts:lookup is gone\nNo reply needed."),
    ).toEqual({});
    expect(await crew.send(PEER.name, "[B1] QUESTION: does your endpoint page after 50?")).toEqual(
      {},
    );
  });

  test("a tag of another phase, or not on the first line, is not the tag", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const crew = await crewStore(hookEnv(), repo, [SELF, PEER]);
    const result = await crew.send(PEER.name, "[B2] CONTRACT: x.ts:lookup is gone");
    expect(result.stdout).toContain('"permissionDecision":"deny"');
    const late = await crew.send(PEER.name, "heads up\n[B1] CONTRACT: x.ts:lookup is gone");
    expect(late.stdout).toContain('"permissionDecision":"deny"');
  });

  test("a message to yourself, or to a session outside the store goes through", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const crew = await crewStore(hookEnv(), repo, [SELF, PEER]);
    expect(await crew.send(SELF.name, "note to self")).toEqual({});
    expect(await crew.send("someone else", "hello")).toEqual({});
  });

  test("F2b-3: a message to its own lead is refused, naming crew report", async () => {
    // `crew tell` matches the lead too (src/crew/tell.ts): a crew session reaches its lead
    // through the recorded report, never a raw message. The tag does not change that — the
    // lead is not a peer.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const crew = await crewStore(hookEnv(), repo, [SELF, PEER]);
    for (const message of ["done", "[B1] CONTRACT: x.ts:lookup is gone"]) {
      expect([message, await crew.send("LEAD app lead", message)]).toEqual([
        message,
        deny(
          [
            '"LEAD app lead" is your lead, and a crew session reaches its lead through crew report, not a message.',
            'Fix: cc-smart-dev-kit crew report --status done --file - (with the JSON part), or cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>',
            "The report is recorded for the lead, and its watch wakes the lead on the line.",
          ].join("\n"),
        ),
      ]);
    }
  });

  test("a session that is no crew session is not judged: the lead messages as it likes", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const plain = hookEnv();
    const crew = await crewStore(plain, repo, [SELF, PEER]);
    // The same message, from a session whose environment names no crew session.
    expect(
      await runHook(
        messageGuardHook,
        {
          cwd: repo,
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          tool_input: { message: "done", to: PEER.name },
          tool_name: "SendMessage",
        },
        plain,
      ),
    ).toEqual({});
    // A crew id the store does not know is no crew session of this repo either.
    expect(
      await runHook(
        messageGuardHook,
        {
          cwd: repo,
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          tool_input: { message: "done", to: PEER.name },
          tool_name: "SendMessage",
        },
        { ...plain, CC_SMART_DEV_KIT_CREW: "no-such-crew" },
      ),
    ).toEqual({});
    expect(crew.env.CC_SMART_DEV_KIT_CREW).toBe(SELF.id);
  });

  test("the other-repo rule is unchanged for a crew session", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const crew = await crewStore(hookEnv(), repo, [SELF, PEER]);
    const elsewhere = tempDir("elsewhere");
    writeSessionRecord(crew.env, { sessionId: "x", cwd: elsewhere, name: "other project" });
    expect(await crew.send("other project", "hi")).toEqual(
      deny(
        [
          `"other project" works in ${elsewhere}, outside this repo: sessions message only sessions of their own repo.`,
          "ListAgents lists every Claude session on the machine, other projects too.",
        ].join("\n"),
      ),
    );
  });

  test("a store whose sender record cannot be read lets the message through (fails open)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const crew = await crewStore(env, repo, [SELF, PEER]);
    writeStoreFile(
      crewFile(cliPaths(env).stateDir, locateCheckout(repo)?.root ?? repo, SELF.id),
      "{",
    );
    expect(await crew.send(PEER.name, "done")).toEqual({});
  });
});
