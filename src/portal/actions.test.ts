import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { makeRepo } from "../testing/hooks";
import { cleanGitEnv, tempDir } from "../testing/temp";
import { MADE_WITHOUT_HOOKS, type ProposedJson } from "../workflow/propose";
import { type ActionContext, portalOmnirouteContext, runAction } from "./actions";
import { addProjectRoot, forgetProjectsList } from "./api/projects";
import { testPortalContext } from "./api/test-context";
import { workflowAdapter } from "./workflow-adapter";

/**
 * The line the fake `workflow propose --json` prints, typed as the real command's own output: a
 * change to that shape fails here before the portal can read a line the command no longer prints.
 */
const FAKE_PROPOSED: ProposedJson = {
  branch: "worktree-workflow-allowCommit-20261023",
  from: false,
  setting: "allowCommit",
  to: true,
  url: "https://github.com/example-org/app/pull/42",
};

function fakePlugin(): { done: string; folder: string; log: string } {
  const folder = tempDir("plugin");
  const log = join(folder, "runs.log");
  const done = join(folder, "done");
  mkdirSync(join(folder, "dist"), { recursive: true });
  writeFileSync(join(folder, "bunfig.toml"), "");
  writeFileSync(
    join(folder, "dist", "cli.js"),
    `import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), claudeCode: process.env.CLAUDECODE ?? null, config: process.env.CLAUDE_CONFIG_DIR, cwd: process.cwd() }) + "\\n");
if (process.env.FAKE_CLI_SLEEP === "1") await Bun.sleep(400);
writeFileSync(${JSON.stringify(done)}, "done\\n");
// workflow propose --json prints one JSON line and nothing else, as the real one does.
if (process.argv[2] === "workflow" && process.argv[3] === "propose") {
  console.log(${JSON.stringify(JSON.stringify(FAKE_PROPOSED))});
} else {
  console.log("command " + process.argv.slice(2).join(" ") + ": done");
}
process.exit(process.env.FAKE_CLI_EXIT === undefined ? 0 : Number(process.env.FAKE_CLI_EXIT));
`,
  );
  return { done, folder, log };
}

/** Every run the fake CLI logged. */
function runsOf(log: string): {
  args: string[];
  claudeCode: null | string;
  config: string;
  cwd: string;
}[] {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return [];
  }
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

/** A portal whose folder is a temp home (no git project), a fake plugin, and two repositories. */
function world(options: { exit?: number; sleep?: boolean } = {}) {
  const home = tempDir("portal-actions-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const plugin = fakePlugin();
  const ctx = testPortalContext(
    paths,
    {
      ...cleanGitEnv(),
      // it inherits `CLAUDECODE=1` from the session start that launched it (D9): a child is
      // given neither.
      CLAUDECODE: "1",
      ...(options.sleep === true ? { FAKE_CLI_SLEEP: "1" } : {}),
      ...(options.exit === undefined ? {} : { FAKE_CLI_EXIT: String(options.exit) }),
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: home,
      PATH: process.env.PATH ?? "",
    },
    () => Date.now(),
    { pluginFolder: () => ({ folder: plugin.folder }) },
  );
  const agentBinary = join(home, "fake-claude");
  writeFileSync(agentBinary, `#!${process.execPath}\nconsole.log("[]");\n`);
  chmodSync(agentBinary, 0o755);
  ctx.which = (name) => (name === "claude" ? agentBinary : null);
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  return {
    action,
    done: plugin.done,
    home,
    log: plugin.log,
    paths,
    repoA: makeRepo("actions-a"),
    repoB: makeRepo("actions-b"),
  };
}

describe("an action runs the CLI's own command in a child", () => {
  test("worktrees.clean runs the CLI's own worktrees --clean in the portal's folder", async () => {
    const w = world();
    const cleaned = await runAction("worktrees.clean", { confirm: true }, w.action);
    expect(cleaned.ok).toBe(true);
    expect(runsOf(w.log)).toMatchObject([{ args: ["worktrees", "--clean"], cwd: w.home }]);
  });

  test("the page's confirmation for that clean says it also deletes the merged builder branches", () => {
    // `worktrees --clean` sweeps `worktree-agent-*` branches (branch-sweep.ts), so the card the
    // person confirms on says so. The card is in the Next app, whose own tests need its
    // node_modules: this reads its source text.
    const card = readFileSync(
      join(import.meta.dir, "..", "..", "portal", "src", "components", "machine-cards.tsx"),
      "utf8",
    );
    expect(card).toContain(
      "Each one goes with its branch. A worktree that is not finished is kept, with its reason. Builder branches (worktree-agent-*) that no worktree uses and whose work the base holds are deleted too; one with commits the base lacks is kept.",
    );
  });
});

describe("workflow.set writes through the workflow module's own writer", () => {
  test("the lead-model hint goes into the person's own workflow.json, never the project's file", async () => {
    const { action, paths, repoA } = world();
    // The real module, not the fake: the file it writes is what this test reads back.
    action.workflow = workflowAdapter;
    action.cwd = repoA;
    const projectFile = join(repoA, ".claude", "cc-smart-dev-kit.json");
    const projectText = '{\n  "requires": ">=0.3",\n  "sessionNames": true\n}\n';
    mkdirSync(join(repoA, ".claude"));
    writeFileSync(projectFile, projectText);

    const result = await runAction(
      "workflow.set",
      { key: "switches.leadHint", value: false },
      action,
    );
    expect(result).toEqual({
      lines: ["+ ~/.config/cc-smart-dev-kit/workflow.json: switches.leadHint = false"],
      ok: true,
    });
    expect(readFileSync(paths.workflowConfigFile, "utf8")).toBe(
      '{\n  "switches": {\n    "leadHint": false\n  }\n}\n',
    );
    expect(readFileSync(projectFile, "utf8")).toBe(projectText);
  });
});

describe("project.workflow.propose runs the CLI's own command in a child", () => {
  /** The project's id, as the list gives it: 12 hex of sha256 of its root. */
  function idOf(root: string): string {
    return createHash("sha256").update(root).digest("hex").slice(0, 12);
  }

  test("--unset removes the project's value, and no confirmation means nothing runs", async () => {
    const w = world();
    await addProjectRoot(w.paths, w.repoA);
    forgetProjectsList();
    expect(
      await runAction(
        "project.workflow.propose",
        { project: idOf(w.repoA), setting: "allowCommit", unset: true },
        w.action,
      ),
    ).toEqual({
      lines: ["Nothing was proposed: the page's confirmation did not come with the request."],
      ok: false,
    });
    expect(runsOf(w.log)).toEqual([]);

    const removed = await runAction(
      "project.workflow.propose",
      { confirm: true, project: idOf(w.repoA), setting: "allowCommit", unset: true },
      w.action,
    );
    expect(removed).toEqual({
      lines: [
        `Opened ${FAKE_PROPOSED.url}`,
        `Branch ${FAKE_PROPOSED.branch}. ${MADE_WITHOUT_HOOKS}`,
      ],
      ok: true,
      url: FAKE_PROPOSED.url,
    });
    expect(runsOf(w.log)).toMatchObject([
      { args: ["workflow", "propose", "allowCommit", "--unset", "--json"], cwd: w.repoA },
    ]);
  });

  test("a run that fails never gives a URL, even when its output holds one", async () => {
    // The fake CLI prints its JSON line and then exits 1: whatever it printed, a refusal has
    // no pull request, and the card must not link one.
    const w = world({ exit: 1 });
    await addProjectRoot(w.paths, w.repoA);
    forgetProjectsList();
    const failed = await runAction(
      "project.workflow.propose",
      { confirm: true, project: idOf(w.repoA), setting: "allowCommit", value: "true" },
      w.action,
    );
    expect(failed.ok).toBe(false);
    expect(failed.url).toBeUndefined();
    expect(failed.lines).toHaveLength(1);
    expect(failed.lines[0]).toContain("pull/42");
  });

  test("no project, or an empty one, is refused before the child: a proposal never runs in the portal's own folder", async () => {
    const w = world();
    await addProjectRoot(w.paths, w.repoA);
    forgetProjectsList();
    const refused = async (extra: Record<string, unknown>) =>
      runAction(
        "project.workflow.propose",
        { confirm: true, setting: "allowCommit", value: "true", ...extra },
        w.action,
      );
    const line = "Name the project by its id: a proposal never runs in the portal's own folder.";
    expect(await refused({})).toEqual({ lines: [line], ok: false });
    expect(await refused({ project: "" })).toEqual({ lines: [line], ok: false });
    expect(await refused({ project: "  " })).toEqual({ lines: [line], ok: false });
    expect(runsOf(w.log)).toEqual([]);
  });

  test("a setting the command does not have, or no value, is refused before the child", async () => {
    const w = world();
    await addProjectRoot(w.paths, w.repoA);
    forgetProjectsList();
    const unknown = await runAction(
      "project.workflow.propose",
      { confirm: true, project: idOf(w.repoA), setting: "worktree.base", value: "main" },
      w.action,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.lines[0]).toStartWith('"worktree.base" is not a setting: the settings are ');
    const empty = await runAction(
      "project.workflow.propose",
      { confirm: true, project: idOf(w.repoA), setting: "allowCommit", value: " " },
      w.action,
    );
    expect(empty.lines).toEqual(["Type the setting's value, or remove it from the project."]);
    expect(runsOf(w.log)).toEqual([]);
  });
});

describe("the Gateway card's actions run the CLI's own command in a child (GP4b)", () => {
  /** The project's id, as the list gives it: 12 hex of sha256 of its root. */
  function idOf(root: string): string {
    return createHash("sha256").update(root).digest("hex").slice(0, 12);
  }

  test("project.gateway.set refuses before the child: no yes, no project, on in the team file, a bad word", async () => {
    const w = world();
    await addProjectRoot(w.paths, w.repoA);
    forgetProjectsList();
    const id = idOf(w.repoA);
    const refused = async (body: Record<string, unknown>) =>
      (await runAction("project.gateway.set", body, w.action)).lines;
    expect(await refused({ project: id, state: "off", team: false })).toEqual([
      "Nothing was changed: the page's confirmation did not come with the request.",
    ]);
    expect(await refused({ confirm: true, state: "off", team: false })).toEqual([
      "Name the project by its id: a gateway state is never written to the portal's own folder.",
    ]);
    expect(await refused({ confirm: true, project: "nope", state: "off", team: false })).toEqual([
      'No project of the list has the id "nope", so nothing was read or written.',
    ]);
    expect(await refused({ confirm: true, project: id, state: "status", team: false })).toEqual([
      '"status" is not a state: say on, off or default.',
    ]);
    expect(await refused({ confirm: true, project: id, state: "on", team: true })).toEqual([
      "The team file takes off or default only: it never points teammates at your own router.",
    ]);
    expect(await refused({ confirm: true, project: id, state: "off", team: "yes" })).toEqual([
      "team is true or false.",
    ]);
    expect(
      await refused({ confirm: true, profile: "--team", project: id, state: "on", team: false }),
    ).toEqual([
      '"--team": a profile name is lower-case letters, digits and - (the /p/<name> of a project\'s URL), at most 64.',
    ]);
    expect(
      await refused({ confirm: true, profile: "cheap", project: id, state: "off", team: false }),
    ).toEqual(["A profile goes with on only."]);
    expect(runsOf(w.log)).toEqual([]);
  });

  test("project.gateway.profile: a slot's chain, Claude, the machine's chain, the fallback", async () => {
    const w = world();
    const run = (body: Record<string, unknown>) =>
      runAction("project.gateway.profile", { confirm: true, profile: "cheap", ...body }, w.action);
    expect(
      (
        await run({
          kind: "slot",
          slot: "scout",
          targets: ["omniroute:glm-5", "omniroute:kimi-k3"],
        })
      ).ok,
    ).toBe(true);
    expect((await run({ kind: "slot", slot: "opus", value: "claude" })).ok).toBe(true);
    expect((await run({ kind: "slot", slot: "worker", value: "machine" })).ok).toBe(true);
    expect((await run({ kind: "fallback", on: false, slot: "scout" })).ok).toBe(true);
    // A machine's own slot, and a Claude target and a model id with "/" and ":" in it: the
    // command takes all of them, so the action does too.
    expect(
      (
        await run({
          kind: "slot",
          slot: "cc-smart-dev-kit-review",
          targets: ["claude-sonnet-5-5", "omniroute:openrouter/deepseek/deepseek-v4.1-flash:floor"],
        })
      ).ok,
    ).toBe(true);
    expect(runsOf(w.log).map((one) => one.args)).toEqual([
      ["gateway", "profile", "cheap", "slot", "scout", "omniroute:glm-5,omniroute:kimi-k3"],
      ["gateway", "profile", "cheap", "slot", "opus", "off"],
      ["gateway", "profile", "cheap", "slot", "worker", "clear"],
      ["gateway", "profile", "cheap", "fallback", "scout", "off"],
      [
        "gateway",
        "profile",
        "cheap",
        "slot",
        "cc-smart-dev-kit-review",
        "claude-sonnet-5-5,omniroute:openrouter/deepseek/deepseek-v4.1-flash:floor",
      ],
    ]);
  });
});

function sessionCandidate(w: ReturnType<typeof world>, state = "done", cwd = w.repoB) {
  const folder = tempDir("session-agent");
  const binary = join(folder, "claude");
  const now = w.action.portal.now();
  w.action.portal.now = () => now;
  const rows = [
    {
      id: "abcd1234",
      sessionId: "finished-session",
      name: "background task",
      cwd,
      kind: "background",
      state,
    },
  ];
  writeFileSync(
    binary,
    `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(rows))});\n`,
  );
  chmodSync(binary, 0o755);
  w.action.portal.which = (name) => (name === "claude" ? binary : null);
  const job = join(w.paths.claudeConfigDir, "jobs", "abcd1234");
  mkdirSync(job, { recursive: true });
  const at = new Date(now - 2 * 86400000).toISOString();
  writeFileSync(
    join(job, "state.json"),
    JSON.stringify({ sessionId: "finished-session", state, updatedAt: at, lastTerminalAt: at }),
  );
  return binary;
}

test("asks first, revalidates shared eligibility, and runs the targeted CLI from home when the session folder is gone", async () => {
  const w = world();
  const folder = join(w.repoB, ".claude", "worktrees", "removed-session");
  expect(existsSync(folder)).toBe(false);
  sessionCandidate(w, "done", folder);
  expect((await runAction("sessions.rm", { id: "abcd1234" }, w.action)).ok).toBe(false);
  expect(runsOf(w.log)).toEqual([]);
  const removed = await runAction("sessions.rm", { id: "abcd1234", confirm: true }, w.action);
  expect(removed.ok).toBe(true);
  expect(runsOf(w.log)).toEqual([
    {
      args: ["sessions", "--finished", "--remove", "--yes", "--id", "abcd1234"],
      claudeCode: null,
      config: w.paths.claudeConfigDir,
      cwd: w.home,
    },
  ]);
});
