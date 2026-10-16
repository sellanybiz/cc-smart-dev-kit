/**
 * The Serena root keeper, and the main-folder guard's Serena branch: which folder Serena
 * edits, and whether an edit through it belongs in a worktree.
 *
 * Every case runs the hook through the same frame Claude Code does (`runHook`), with a real
 * git repo and worktree in a temp folder.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import {
  activatedRoot,
  activationAllowed,
  readSerenaRoot,
  SERENA_ACTIVATE_TOOL,
  serenaRootFile,
  writeSerenaRoot,
} from "./serena-root";
import { mainFolderGuardHook, serenaRootHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const GUARDED = { worktrees: { base: "main", prefix: "app-wt-", guardMainFolder: true } };

/** A clone with one worktree beside it: `<temp>/app` and `<temp>/app-wt-x`. */
function repoWithWorktree(): { repo: string; worktree: string } {
  const { repo } = makeClone();
  const worktree = join(dirname(repo), "app-wt-x");
  git(repo, "worktree", "add", "-q", "-b", "feat/x", worktree);
  return { repo, worktree };
}

/** What one hook run printed, parsed. */
function outputOf(result: { stdout?: string }): {
  additionalContext?: string;
  permissionDecision?: string;
  permissionDecisionReason?: string;
} {
  return (
    (JSON.parse(result.stdout ?? "{}") as { hookSpecificOutput?: Record<string, string> })
      .hookSpecificOutput ?? {}
  );
}

/** An activation of `project`, as a session sends it. */
function activationInput(cwd: string, project: unknown): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: SERENA_ACTIVATE_TOOL,
    tool_input: { project },
  };
}

/** A Serena edit, as a session sends it. */
function serenaEditInput(
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: `mcp__serena__${tool}`,
    tool_input: toolInput,
  };
}

describe("the record", () => {
  test("written, read back, and cleared; an id that cannot be a file name gets no record", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    expect(readSerenaRoot(paths, SESSION)).toBeUndefined();
    writeSerenaRoot(paths, SESSION, { kind: "path", path: "/work/app-wt-x" });
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "path", path: "/work/app-wt-x" });
    // Its own file, in cc-smart-dev-kit's state folder, readable only by its owner.
    const file = serenaRootFile(paths, SESSION) ?? "";
    expect(file).toBe(join(paths.stateDir, "serena-root", `${SESSION}.txt`));
    expect(readFileSync(file, "utf8").trim()).toBe("/work/app-wt-x");
    writeSerenaRoot(paths, SESSION, { kind: "unknown" });
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });
    expect(readSerenaRoot(paths, "../escape")).toBeUndefined();
    expect(serenaRootFile(paths, "../escape")).toBeNull();
  });

  test("a record that names no absolute folder reads as unknown; a broken one cannot be guessed", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const file = serenaRootFile(paths, SESSION) ?? "";
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "app\n"); // a project NAME, not a folder
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });
    writeFileSync(file, "");
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });
  });
});

describe("Serena's answer, and which folders may be activated", () => {
  test("both activation messages, from a string or from content blocks", () => {
    expect(
      activatedRoot({
        content: [{ text: "The project with name 'app' at /work/app is activated." }],
      }),
    ).toBe("/work/app");
    expect(activatedRoot("Created and activated a new project with name 'x' at /work/x.")).toBe(
      "/work/x",
    );
    expect(activatedRoot({ content: [{ text: "Nothing about a project here." }] })).toBeUndefined();
    expect(activatedRoot(null)).toBeUndefined();
  });

  test("only this repo's folders, by absolute path", () => {
    const folders = ["/work/app", "/work/app-wt-x"];
    expect(activationAllowed("/work/app", folders)).toBe(true);
    expect(activationAllowed("/work/app-wt-x", folders)).toBe(true);
    expect(activationAllowed("app", folders)).toBe(false); // a project name
    expect(activationAllowed("/work/elsewhere", folders)).toBe(false);
    expect(activationAllowed("relative/app", folders)).toBe(false);
    expect(activationAllowed(undefined, folders)).toBe(false);
  });
});

describe("the keeper, through the hook frame", () => {
  test("an activation by absolute path is allowed, and distrusted until it answers; a name is refused", async () => {
    const { repo, worktree } = repoWithWorktree();
    const env = hookEnv();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", GUARDED);
    const paths = cliPaths(env);

    // Allowed, and the old record is dropped at once: until Serena's own answer arrives,
    // where this session's edits land is not known.
    writeSerenaRoot(paths, SESSION, { kind: "path", path: repo });
    expect(await runHook(serenaRootHook, activationInput(repo, worktree), env)).toEqual({});
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });
    // The main checkout itself too.
    expect(await runHook(serenaRootHook, activationInput(worktree, repo), env)).toEqual({});
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });

    const byName = await runHook(serenaRootHook, activationInput(repo, "app"), env);
    expect(outputOf(byName).permissionDecision).toBe("deny");
    expect(outputOf(byName).permissionDecisionReason).toContain("never a project name");
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });

    const elsewhere = await runHook(
      serenaRootHook,
      activationInput(repo, tempDir("elsewhere")),
      env,
    );
    expect(outputOf(elsewhere).permissionDecision).toBe("deny");
  });

  test("PostToolUse records the folder Serena reports, and only that", async () => {
    const { repo, worktree } = repoWithWorktree();
    const env = hookEnv();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", GUARDED);
    const paths = cliPaths(env);
    writeSerenaRoot(paths, SESSION, { kind: "unknown" });

    const answered = {
      ...activationInput(repo, worktree),
      hook_event_name: "PostToolUse",
      tool_response: {
        content: [{ text: `The project with name 'app' at ${worktree} is activated.` }],
      },
    };
    expect(await runHook(serenaRootHook, answered, env)).toEqual({});
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "path", path: worktree });

    // An answer that names no folder: the record keeps what it had (here: the main checkout,
    // as if an earlier activation had been confirmed), never a guess.
    writeSerenaRoot(paths, SESSION, { kind: "path", path: repo });
    const unclear = {
      ...activationInput(repo, repo),
      hook_event_name: "PostToolUse",
      tool_response: { content: [{ text: "Something else entirely." }] },
    };
    expect(await runHook(serenaRootHook, unclear, env)).toEqual({});
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "path", path: repo });
  });

  test("a session start: startup forgets the record, resume and clear and fork cannot know it", async () => {
    const { repo } = repoWithWorktree();
    const env = hookEnv();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", GUARDED);
    const paths = cliPaths(env);
    const start = (source: string): Record<string, unknown> => ({
      hook_event_name: "SessionStart",
      session_id: SESSION,
      cwd: repo,
      source,
    });

    writeSerenaRoot(paths, SESSION, { kind: "path", path: repo });
    expect(await runHook(serenaRootHook, start("startup"), env)).toEqual({});
    expect(readSerenaRoot(paths, SESSION)).toBeUndefined();

    for (const source of ["resume", "clear", "fork"]) {
      writeSerenaRoot(paths, SESSION, { kind: "path", path: repo });
      expect(await runHook(serenaRootHook, start(source), env)).toEqual({});
      expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "unknown" });
    }

    writeSerenaRoot(paths, SESSION, { kind: "path", path: repo });
    expect(await runHook(serenaRootHook, start("compact"), env)).toEqual({});
    expect(readSerenaRoot(paths, SESSION)).toEqual({ kind: "path", path: repo });
  });

  test("a project that did not turn the guard on: nothing is recorded, nothing is refused", async () => {
    const { repo } = repoWithWorktree();
    const env = hookEnv();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-" },
    });
    expect(await runHook(serenaRootHook, activationInput(repo, tempDir("elsewhere")), env)).toEqual(
      {},
    );
    expect(readSerenaRoot(cliPaths(env), SESSION)).toBeUndefined();
  });
});

describe("the main-folder guard on a Serena edit", () => {
  /** A guarded repo, a worktree, and a record as `record` says. */
  function guarded(
    record: { kind: "path"; path: string } | { kind: "unknown" } | null,
    projectDir?: string,
  ) {
    const { repo, worktree } = repoWithWorktree();
    const env = hookEnv();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", GUARDED);
    if (record !== null) writeSerenaRoot(cliPaths(env), SESSION, record);
    if (projectDir !== undefined) env["CLAUDE_PROJECT_DIR"] = projectDir;
    return { env, repo, worktree };
  }

  test("a Serena edit of a file in the main checkout is refused, and the refusal says how", async () => {
    const { env, repo } = guarded({ kind: "path", path: "" });
    const paths = cliPaths(env);
    writeSerenaRoot(paths, SESSION, { kind: "path", path: repo });
    const result = await runHook(
      mainFolderGuardHook,
      serenaEditInput(repo, "replace_symbol_body", {
        name_path: "Greeting",
        relative_path: "src/app.ts",
      }),
      env,
    );
    expect(outputOf(result).permissionDecision).toBe("deny");
    expect(outputOf(result).permissionDecisionReason).toContain(
      "A Serena edit lands in the project Serena has active, and that is the main checkout",
    );
    expect(outputOf(result).permissionDecisionReason).toContain("activate_project");
  });

  test("the same edit with Serena pointed at the worktree passes", async () => {
    const { env, repo, worktree } = guarded({ kind: "path", path: "" });
    writeSerenaRoot(cliPaths(env), SESSION, { kind: "path", path: worktree });
    const result = await runHook(
      mainFolderGuardHook,
      serenaEditInput(worktree, "replace_symbol_body", {
        name_path: "Greeting",
        relative_path: "src/app.ts",
      }),
      env,
    );
    expect(result).toEqual({});
    expect(repo).toContain("app");
  });

  test("with no record Serena is at the folder the session started in", async () => {
    // Started in the main checkout: the edit lands there, and is refused.
    const inMain = guarded(null, undefined);
    writeClaudeFile(inMain.repo, "cc-smart-dev-kit.json", GUARDED);
    const mainEnv = { ...inMain.env, CLAUDE_PROJECT_DIR: inMain.repo };
    const refused = await runHook(
      mainFolderGuardHook,
      serenaEditInput(inMain.repo, "replace_content", {
        relative_path: "src/app.ts",
        content: "x",
      }),
      mainEnv,
    );
    expect(outputOf(refused).permissionDecision).toBe("deny");

    // Started in its worktree (`claude -w`): the same relative path is a worktree file.
    const inWorktree = guarded(null, undefined);
    writeClaudeFile(inWorktree.repo, "cc-smart-dev-kit.json", GUARDED);
    const worktreeEnv = { ...inWorktree.env, CLAUDE_PROJECT_DIR: inWorktree.worktree };
    expect(
      await runHook(
        mainFolderGuardHook,
        serenaEditInput(inWorktree.worktree, "replace_content", {
          content: "x",
          relative_path: "src/app.ts",
        }),
        worktreeEnv,
      ),
    ).toEqual({});
  });

  test("no record and no start folder, or a record that reads unknown: the guard asks, never passes", async () => {
    const noRoot = guarded(null, undefined);
    const asked = await runHook(
      mainFolderGuardHook,
      serenaEditInput(noRoot.repo, "replace_symbol_body", { relative_path: "src/app.ts" }),
      noRoot.env,
    );
    expect(outputOf(asked).permissionDecision).toBe("ask");
    expect(outputOf(asked).permissionDecisionReason).toContain(
      "the folder Serena has active is not known to cc-smart-dev-kit",
    );

    const unknown = guarded({ kind: "unknown" }, "/work/whatever");
    const alsoAsked = await runHook(
      mainFolderGuardHook,
      serenaEditInput(unknown.repo, "rename_symbol", {
        name_path: "Greeting",
        relative_path: "src/app.ts",
      }),
      unknown.env,
    );
    expect(outputOf(alsoAsked).permissionDecision).toBe("ask");
  });

  test("replace_in_files with no path is the whole project: refused when Serena is at the main checkout", async () => {
    const { env, repo } = guarded(null, undefined);
    writeSerenaRoot(cliPaths(env), SESSION, { kind: "path", path: repo });
    const result = await runHook(
      mainFolderGuardHook,
      serenaEditInput(repo, "replace_in_files", { paths_include_glob: "**/*.ts" }),
      env,
    );
    expect(outputOf(result).permissionDecision).toBe("deny");
  });

  test("a project that did not turn the guard on: a Serena edit passes", async () => {
    const { repo } = repoWithWorktree();
    const env = hookEnv();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-" },
    });
    writeSerenaRoot(cliPaths(env), SESSION, { kind: "path", path: repo });
    expect(
      await runHook(
        mainFolderGuardHook,
        serenaEditInput(repo, "replace_symbol_body", { relative_path: "src/app.ts" }),
        env,
      ),
    ).toEqual({});
  });

  test("a Serena edit of a file outside the repo is not this guard's business", async () => {
    const { env, repo } = guarded(null, undefined);
    writeSerenaRoot(cliPaths(env), SESSION, { kind: "path", path: repo });
    const outside = join(tempDir("outside"), "x.ts");
    expect(
      await runHook(
        mainFolderGuardHook,
        serenaEditInput(repo, "replace_symbol_body", { relative_path: `../../${outside}` }),
        env,
      ),
    ).toEqual({});
    expect(existsSync(outside)).toBe(false);
  });
});
