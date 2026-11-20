/**
 * The 6.1.0 rename: `allowCommit`, `allowPush` and `allowMerge`, with the old `autoCommit`,
 * `autoPush` and `autoMerge` read as aliases in both files, and every write using the new name.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { ccSmartDevKitConfigSchema } from "../project/config";
import { hookEnv, makeRepo } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { runWorkflow, type WorkflowContext } from "./commands";
import { resolveWorkflow } from "./resolve";
import {
  personalWorkflowSchema,
  WORKFLOW_KEY_ALIASES,
  WORKFLOW_KEYS,
  workflowSchema,
} from "./schema";
import { writePersonalSetting, writeProjectSetting } from "./write";

type Env = ReturnType<typeof hookEnv>;

/** Writes the person's own defaults file, exactly as given (an old file keeps its old names). */
function writePersonal(env: Env, value: unknown): string {
  const { workflowConfigFile } = cliPaths(env);
  mkdirSync(dirname(workflowConfigFile), { recursive: true });
  writeFileSync(workflowConfigFile, `${JSON.stringify(value, null, 2)}\n`);
  return workflowConfigFile;
}

/** A project whose committed file is `text`. */
function projectWith(text: string): { repo: string; file: string; env: Env } {
  const env = hookEnv();
  const repo = makeRepo();
  const file = join(repo, ".claude", "cc-smart-dev-kit.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { repo, file, env };
}

function run(cwd: string, env: Env, argv: string[]) {
  const lines: string[] = [];
  const errors: string[] = [];
  const context: WorkflowContext = {
    paths: cliPaths(env),
    cwd,
    env,
    print: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  return { lines, errors, done: runWorkflow(argv, context) };
}

describe("the alias table", () => {
  test("each old name points at its allow name, and the new names are the settings", () => {
    expect(WORKFLOW_KEY_ALIASES).toEqual({
      autoCommit: "allowCommit",
      autoPush: "allowPush",
      autoMerge: "allowMerge",
    });
    for (const current of Object.values(WORKFLOW_KEY_ALIASES)) {
      expect(WORKFLOW_KEYS).toContain(current);
    }
    for (const old of Object.keys(WORKFLOW_KEY_ALIASES)) {
      expect(WORKFLOW_KEYS as readonly string[]).not.toContain(old);
    }
  });
});

describe("an old name in a file", () => {
  test("the project's schema and the person's both read it as the new name", () => {
    expect(workflowSchema.parse({ autoCommit: true, autoPush: false, autoMerge: true })).toEqual({
      allowCommit: true,
      allowPush: false,
      allowMerge: true,
    });
    expect(personalWorkflowSchema.parse({ autoPush: true, switches: { jobRoute: true } })).toEqual({
      allowPush: true,
      switches: { jobRoute: true },
    });
  });

  test("both names in one file: the new name wins, in either file", () => {
    const both = { autoPush: true, allowPush: false };
    expect(workflowSchema.parse(both)).toEqual({ allowPush: false });
    expect(personalWorkflowSchema.parse(both)).toEqual({ allowPush: false });
  });

  test("an old name with a wrong value is still refused, and a typo is still refused", () => {
    expect(workflowSchema.safeParse({ autoPush: "yes" }).success).toBe(false);
    expect(workflowSchema.safeParse({ autoPushes: true }).success).toBe(false);
  });

  test("the person's file: an old name resolves as set, from the person", () => {
    const env = hookEnv();
    writePersonal(env, { autoCommit: true, autoPush: true, autoMerge: true });
    const resolved = resolveWorkflow(cliPaths(env), null);
    expect(resolved.allowCommit).toEqual({ value: true, source: "personal" });
    expect(resolved.allowPush).toEqual({ value: true, source: "personal" });
    expect(resolved.allowMerge).toEqual({ value: true, source: "personal" });
  });

  test("the project's file: an old name resolves as set, from the project", () => {
    const env = hookEnv();
    const config = ccSmartDevKitConfigSchema.parse({ workflow: { autoPush: true } });
    const resolved = resolveWorkflow(cliPaths(env), config);
    expect(resolved.allowPush).toEqual({ value: true, source: "project" });
    expect(resolved.allowCommit.source).toBe("default");
  });

  test("an old name in the person's file and the new name in the project's: the project still wins", () => {
    const env = hookEnv();
    writePersonal(env, { autoPush: true });
    const config = ccSmartDevKitConfigSchema.parse({ workflow: { allowPush: false } });
    expect(resolveWorkflow(cliPaths(env), config).allowPush).toEqual({
      value: false,
      source: "project",
    });
  });
});

describe("a write uses the new name", () => {
  test("the person's file: set with an old name writes the new one and drops the old", () => {
    const env = hookEnv();
    const file = writePersonal(env, { autoPush: false, openPr: "off" });
    writePersonalSetting(cliPaths(env), "autoPush", true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ allowPush: true, openPr: "off" });
  });

  test("the person's file: unset removes both names, so the old one cannot come back", () => {
    const env = hookEnv();
    const file = writePersonal(env, { autoPush: true, allowPush: true });
    writePersonalSetting(cliPaths(env), "allowPush", undefined);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  });

  test("the project's file: a write with an old name writes the new one and raises requires to 6.1", () => {
    const { repo, file, env } = projectWith(
      JSON.stringify({ requires: ">=1.0", workflow: { autoCommit: true } }),
    );
    writeProjectSetting(repo, "autoCommit", false, env);
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.workflow).toEqual({ allowCommit: false });
    expect(written.requires).toBe(">=6.1");
  });
});

describe("workflow set and unset with an old name", () => {
  test("set autoPush true writes allowPush and says so in one line", async () => {
    const env = hookEnv();
    const file = writePersonal(env, {});
    const result = run(tempDir("not-git"), env, ["set", "autoPush", "true"]);
    expect(await result.done).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.lines[0]).toBe(
      "autoPush is now called allowPush: using allowPush (the old name still works in a file)",
    );
    expect(result.lines[1]).toContain("allowPush = true");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ allowPush: true });
  });

  test("unset autoMerge removes the setting under both names", async () => {
    const env = hookEnv();
    const file = writePersonal(env, { autoMerge: true });
    const result = run(tempDir("not-git"), env, ["unset", "autoMerge"]);
    expect(await result.done).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  });

  test("the new name prints no rename line", async () => {
    const env = hookEnv();
    writePersonal(env, {});
    const result = run(tempDir("not-git"), env, ["set", "allowCommit", "true"]);
    expect(await result.done).toBe(0);
    expect(result.lines.some((line) => line.includes("is now called"))).toBe(false);
  });

  test("show prints the new names", async () => {
    const env = hookEnv();
    writePersonal(env, { autoPush: true });
    const result = run(tempDir("not-git"), env, ["show"]);
    expect(await result.done).toBe(0);
    expect(result.lines).toContain("allowPush = true (personal)");
    expect(result.lines.some((line) => line.startsWith("autoPush"))).toBe(false);
  });

  test("propose accepts an old name too", async () => {
    const env = hookEnv();
    const result = run(tempDir("not-git"), env, ["propose", "autoMerge", "true"]);
    await result.done;
    // Not a git project, so the run stops; it must stop for that, never for an unknown setting.
    expect(result.errors.join("\n")).not.toContain("Unknown setting");
  });
});
