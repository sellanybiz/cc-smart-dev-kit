/**
 * `doctor`'s one line for GitHub Issues (D67): with the switch on, whether `gh` is logged in for
 * origin's host and may write issues there; with it off, nothing. Each failure carries its fix.
 * While the switch is only the built-in default (on since 5.0.0), a project that cannot file gets
 * `·` info lines, never a failure or a nudge: the person never set the switch.
 */
import { describe, expect, test } from "bun:test";
import { COMMAND } from "../build-info/names";
import { projectChecks } from "../cli/project-checks";
import { type IssuesSetup, issuesWorld } from "../testing/issues-world";
import { issuesChecks } from "./doctor";

/** The project's file with no `issues` setting: the switch is the built-in default. */
const DEFAULT = { worktrees: { base: "main" } };
/** The project's file that turns the switch off. */
const OFF = { worktrees: { base: "main" }, workflow: { issues: { enabled: false } } };

const check = (setup: IssuesSetup = {}) => {
  const { gh, world } = issuesWorld(setup);
  return { gh, run: () => issuesChecks(world) };
};

describe("doctor: GitHub Issues", () => {
  test("set off: no line at all, and gh is not even asked", async () => {
    const { gh, run } = check({ committed: OFF });
    expect(await run()).toEqual([]);
    expect(gh.calls).toEqual([]);
  });

  test("on and working: one line, naming the repository", async () => {
    const { gh, run } = check();
    expect(await run()).toEqual([
      {
        ok: true,
        text: "issues: gh is logged in for github.com and can file issues in example-org/my-app",
      },
    ]);
    // Logged in is asked of origin's host; the repository is named in full each time.
    expect(gh.calls[0]?.args).toEqual(["auth", "status", "--hostname", "github.com", "--active"]);
  });

  test("gh missing: a failure, with where to get it", async () => {
    const [line] = await check({ gh: { mode: "missing" } }).run();
    expect(line).toEqual({
      fix: "install GitHub's CLI from https://cli.github.com, then run: gh auth login",
      ok: false,
      text: "issues: gh is not installed, so the kit cannot file issues",
    });
  });

  test("logged out: a failure, with gh auth login", async () => {
    const [line] = await check({ gh: { mode: "logged-out" } }).run();
    expect(line).toEqual({
      fix: "gh auth login --hostname github.com",
      ok: false,
      text: "issues: gh is not logged in for github.com",
    });
  });

  test("timed out: a failure that says so", async () => {
    const [line] = await check({ gh: { mode: "timeout" } }).run();
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain("timed out");
  });

  test("origin not on GitHub: a failure with its fix", async () => {
    const [line] = await check({
      origin: "https://gitlab.example.com/example-org/my-app.git",
    }).run();
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain("not on github.com");
    expect(line?.ok === false && line.fix).toContain("origin");
  });

  test("the repository has issues turned off: a failure with its fix", async () => {
    const [line] = await check({ gh: { hasIssuesEnabled: false } }).run();
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain("issues turned off");
    expect(line?.ok === false && line.fix).toContain("Settings");
  });

  test("only read access: a failure, since a label cannot be applied", async () => {
    const [line] = await check({ gh: { permission: "READ" } }).run();
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain("READ");
    expect(line?.ok === false && line.fix).toContain("write access");
  });

  test("triage access: a warning, since it applies labels but cannot create them", async () => {
    const [line] = await check({ gh: { permission: "TRIAGE" } }).run();
    expect(line).toMatchObject({ ok: true, warn: true });
    expect(line?.text).toContain("can apply labels but not create them");
    expect(line?.ok && line.fix).toContain("kit:found");
  });

  test("maintain and admin are fine", async () => {
    for (const permission of ["MAINTAIN", "ADMIN"] as const) {
      const [line] = await check({ gh: { permission } }).run();
      expect(line).toMatchObject({ ok: true });
      expect(line?.ok && line.warn).toBeUndefined();
    }
  });

  test("a public repository with allowPublic off: a warning with the command", async () => {
    const [line] = await check({ gh: { visibility: "PUBLIC" } }).run();
    expect(line).toMatchObject({ ok: true, warn: true });
    expect(line?.text).toContain("public");
    expect(line?.ok && line.fix).toContain(`${COMMAND} workflow set issues.allowPublic true`);
  });

  test("a public repository with allowPublic on: the working line says public", async () => {
    const [line] = await check({
      committed: {
        worktrees: { base: "main" },
        workflow: { issues: { allowPublic: true, enabled: true } },
      },
      gh: { visibility: "PUBLIC" },
    }).run();
    expect(line).toEqual({
      ok: true,
      text: "issues: gh is logged in for github.com and can file issues in example-org/my-app (public repository)",
    });
  });
});

describe("doctor: the switch is only the default", () => {
  const quiet = (setup: IssuesSetup = {}) => check({ committed: DEFAULT, ...setup });
  const INSTEAD = "follow-ups go in the summary instead";
  const GITLAB = "https://gitlab.example.com/example-org/my-app.git";

  test("a working setup says so as it always did", async () => {
    expect(await quiet().run()).toEqual([
      {
        ok: true,
        text: "issues: gh is logged in for github.com and can file issues in example-org/my-app",
      },
    ]);
  });

  test("origin not on GitHub: an info line, no failure and no fix", async () => {
    const lines = await quiet({ origin: GITLAB }).run();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ info: true, ok: true });
    expect(lines[0]?.text).toContain("not on github.com");
    expect(lines[0]?.text).toContain(INSTEAD);
  });

  test("no origin at all: an info line", async () => {
    const lines = await quiet({ origin: null }).run();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ info: true, ok: true });
  });

  test("gh missing, logged out, timed out: info lines that name the summary", async () => {
    for (const mode of ["missing", "logged-out", "timeout"] as const) {
      const lines = await quiet({ gh: { mode } }).run();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ info: true, ok: true });
      expect(lines[0]?.text).toContain(INSTEAD);
    }
  });

  test("issues off in the repository, or read-only access: info lines", async () => {
    for (const gh of [{ hasIssuesEnabled: false }, { permission: "READ" as const }]) {
      const lines = await quiet({ gh }).run();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ info: true, ok: true });
      expect(lines[0]?.text).toContain(INSTEAD);
    }
  });

  test("a public repository with allowPublic off: an info line, and no nudge", async () => {
    const lines = await quiet({ gh: { visibility: "PUBLIC" } }).run();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ info: true, ok: true });
    expect(lines[0]?.text).toContain("public");
    expect(lines[0]?.text).toContain(INSTEAD);
    expect(JSON.stringify(lines)).not.toContain("allowPublic");
    expect(lines[0]?.ok && lines[0].warn).toBeUndefined();
    expect(lines[0]?.ok && lines[0].fix).toBeUndefined();
  });

  test("triage access: an info line, no warning", async () => {
    const lines = await quiet({ gh: { permission: "TRIAGE" } }).run();
    expect(lines[0]).toMatchObject({ info: true, ok: true });
    expect(lines[0]?.ok && lines[0].warn).toBeUndefined();
  });

  test("set by the project or the person, the same trouble is a failure as before", async () => {
    const project = await check({ origin: GITLAB }).run();
    expect(project[0]?.ok).toBe(false);
    const personal = await check({
      committed: DEFAULT,
      origin: GITLAB,
      personal: { issues: { enabled: true } },
    }).run();
    expect(personal[0]?.ok).toBe(false);
    const gone = await check({
      committed: DEFAULT,
      gh: { mode: "missing" },
      personal: { issues: { enabled: true } },
    }).run();
    expect(gone[0]?.ok).toBe(false);
  });

  test("set explicitly, a public repository keeps its warning and the nudge", async () => {
    const [line] = await check({ gh: { visibility: "PUBLIC" } }).run();
    expect(line).toMatchObject({ ok: true, warn: true });
    expect(line?.ok && line.fix).toContain("issues.allowPublic");
  });
});

describe("doctor: the project's checks carry the line", () => {
  test("switch on: the line is among the project's; off: it is not", async () => {
    const on = issuesWorld();
    const lines = await projectChecks(
      on.repo,
      on.env,
      on.paths,
      "/nonexistent/hooks.json",
      on.gh.exec,
    );
    expect(lines.map((one) => one.text)).toContain(
      "issues: gh is logged in for github.com and can file issues in example-org/my-app",
    );
    const off = issuesWorld({ committed: OFF });
    const none = await projectChecks(
      off.repo,
      off.env,
      off.paths,
      "/nonexistent/hooks.json",
      off.gh.exec,
    );
    expect(none.filter((one) => one.text.startsWith("issues:"))).toEqual([]);
    expect(off.gh.calls).toEqual([]);
  });
});
