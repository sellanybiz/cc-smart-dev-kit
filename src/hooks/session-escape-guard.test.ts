/**
 * The session-escape guard (`session-escape-guard.ts`): what it denies, what it asks, what it
 * lets through, and that it holds outside a project, with a broken project file, with
 * `ownHooks` naming it, and when it crashes.
 *
 * Every expectation is written by hand. A fixture never touches the real home: `hookEnv()`
 * gives a temp HOME and Claude config folder.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { DEFAULT_PORTAL_PORT } from "../ports";
import { hookEnv, makeClone, runEntry, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import type { HookInput, HookResult } from "./io";
import { handleHook } from "./run";
import { inEscapeDomain, sessionEscapeGuard } from "./session-escape-guard";
import { sessionEscapeGuardHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const KIT = "cc-smart-dev-kit";

/** The decision a result carries, or null for silence. */
function decisionOf(result: HookResult): { decision: string; reason: string } | null {
  if (result.stdout === undefined) return null;
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  return { decision: output.permissionDecision, reason: output.permissionDecisionReason };
}

function shellInput(command: string, cwd: string, tool = "Bash"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: tool,
    tool_input: { command },
  };
}

function editInput(file: string, cwd: string, tool = "Edit"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: tool,
    tool_input: tool === "NotebookEdit" ? { notebook_path: file } : { file_path: file },
  };
}

/** A clone with a worktree of Claude Code's own shape: `<repo>/.claude/worktrees/wt`. */
function repoWithWorktree(): { repo: string; worktree: string } {
  const { repo } = makeClone();
  const worktree = join(repo, ".claude", "worktrees", "wt");
  git(repo, "worktree", "add", "-q", "-b", "worktree-wt", worktree);
  return { repo, worktree };
}

async function run(input: Record<string, unknown>, env = hookEnv()) {
  return decisionOf(await runHook(sessionEscapeGuardHook, input, env));
}

describe("workflow review-done: denied, in every way a line can run it", () => {
  const { repo } = makeClone();
  test.each([
    `${KIT} workflow review-done`,
    `${KIT} workflow review-done --sha abc1234`,
    `"$HOME/.local/bin/${KIT}" workflow review-done`,
    `~/.local/bin/${KIT}.cmd workflow review-done`,
    `bun /plugin/dist/cli.js workflow review-done`,
    `bun run src/entries/cli.ts workflow review-done`,
    `git status && ${KIT} workflow review-done`,
    `bash -c '${KIT} workflow review-done'`,
    `bash -c "bash -c '${KIT} workflow review-done'"`,
    `echo '${KIT} workflow review-done' | sh`,
    `echo done | xargs ${KIT} workflow review-done`,
    `find . -maxdepth 0 -exec ${KIT} workflow review-done \\;`,
    `timeout 5 ${KIT} workflow review-done`,
    `${KIT} workflow review-done >/dev/null 2>&1`,
    `${KIT} job run --kind test -- ${KIT} workflow review-done`,
  ])("%s", async (command) => {
    const answer = await run(shellInput(command, repo));
    expect(answer?.decision).toBe("deny");
    expect(answer?.reason).toContain("records a review by hand");
  });

  test("the PowerShell tool reads it too", async () => {
    const answer = await run(shellInput(`& ${KIT}.cmd workflow review-done`, repo, "PowerShell"));
    expect(answer?.decision).toBe("deny");
    const nested = await run(
      shellInput(`pwsh -Command "${KIT} workflow review-done"`, repo, "PowerShell"),
    );
    expect(nested?.decision).toBe("deny");
  });

  test.each([
    `${KIT} workflow show`,
    `${KIT} workflow set autoMerge true`,
    `${KIT} doctor`,
    `git commit -m "docs: ${KIT} workflow review-done is for the person"`,
    `grep -rn "workflow review-done" docs`,
    `grep -rn ${KIT} workflow review-done`,
    `echo ${KIT} workflow review-done`,
    `ls ~/.local/bin/${KIT}`,
    `cat <<'EOF'\n${KIT} workflow review-done\nEOF`,
    `# ${KIT} workflow review-done`,
  ])("not a run of it: %s", async (command) => {
    expect(await run(shellInput(command, repo))).toBeNull();
  });
});

describe("a kit command with CLAUDECODE removed: denied", () => {
  const { repo } = makeClone();
  const KIT_LINE = `${KIT} workflow set reviewBeforePush false`;
  const droppers: [string, string][] = [
    ["env -u", `env -u CLAUDECODE ${KIT_LINE}`],
    ["env -uNAME", `env -uCLAUDECODE ${KIT_LINE}`],
    ["env --unset=NAME", `env --unset=CLAUDECODE ${KIT_LINE}`],
    ["env --unset NAME", `env --unset CLAUDECODE ${KIT_LINE}`],
    ["env -i", `env -i ${KIT_LINE}`],
    ["env -iu", `env -iu HOME ${KIT_LINE}`],
    ["env --ignore-environment", `env --ignore-environment ${KIT_LINE}`],
    ["env -", `env - ${KIT_LINE}`],
    ["env after another option", `env -C /tmp -u CLAUDECODE ${KIT_LINE}`],
    ["env -S", `env -S 'env -u CLAUDECODE ${KIT_LINE}'`],
    ["emptied for one command", `CLAUDECODE= ${KIT_LINE}`],
    ["set to another value", `CLAUDECODE=0 ${KIT_LINE}`],
    ["emptied through env", `env CLAUDECODE= ${KIT_LINE}`],
    ["unset before it", `unset CLAUDECODE; ${KIT_LINE}`],
    ["unset -v before it", `unset -v CLAUDECODE && ${KIT_LINE}`],
    ["export emptied", `export CLAUDECODE=; ${KIT_LINE}`],
    ["export -n", `export -n CLAUDECODE; ${KIT_LINE}`],
    ["declare +x", `declare +x CLAUDECODE; ${KIT_LINE}`],
    ["assignment alone", `CLAUDECODE=; ${KIT_LINE}`],
    ["inside a subshell", `(unset CLAUDECODE; ${KIT_LINE})`],
    ["unset inside a block", `{ unset CLAUDECODE; ${KIT_LINE}; }`],
    ["unset in an eval", `eval 'unset CLAUDECODE'; ${KIT_LINE}`],
    ["unset in the shell that runs it", `bash -c 'unset CLAUDECODE; ${KIT_LINE}'`],
    ["dropped for the shell that runs it", `env -u CLAUDECODE bash -c '${KIT_LINE}'`],
    ["dropped for a deeper shell", `env -u CLAUDECODE sh -c "bash -c '${KIT_LINE}'"`],
    ["dropped for xargs", `echo x | env -u CLAUDECODE xargs ${KIT_LINE}`],
    ["dropped for find -exec", `env -u CLAUDECODE find . -maxdepth 0 -exec ${KIT_LINE} \\;`],
    ["behind time and nohup", `env -u CLAUDECODE nohup time ${KIT_LINE}`],
    ["sudo resets the environment", `sudo ${KIT_LINE}`],
    ["sudo -E", `sudo -E ${KIT_LINE}`],
    ["su -c", `su -c '${KIT_LINE}' root`],
    ["ssh to this machine", `ssh localhost '${KIT_LINE}'`],
    ["systemd-run", `systemd-run --user --pipe ${KIT_LINE}`],
    ["the bundle by path", `env -u CLAUDECODE bun /plugin/dist/cli.js workflow set autoMerge true`],
    ["the portal command", `env -u CLAUDECODE ${KIT} portal --no-open`],
    ["the portal bundle", `env -u CLAUDECODE bun ~/.local/share/${KIT}/dist/portal.js`],
    ["a line that runs through the queue", `env -u CLAUDECODE ${KIT} job run -- ${KIT_LINE}`],
    ["a line joined at a backslash", `env -u CLAUDECODE \\\n${KIT_LINE}`],
    ["a quote that never closes", `env -u CLAUDECODE ${KIT_LINE} "oops`],
    ["a here-string into a shell", `env -u CLAUDECODE bash <<< '${KIT_LINE}'`],
  ];
  test.each(droppers)("%s", async (_name, command) => {
    const answer = await run(shellInput(command, repo));
    expect(answer?.decision).toBe("deny");
    expect(answer?.reason).toContain("with CLAUDECODE removed");
  });

  test.each([
    ["Remove-Item Env:", `Remove-Item Env:CLAUDECODE; ${KIT_LINE}`],
    ["Remove-Item Env:\\", `Remove-Item Env:\\CLAUDECODE ; ${KIT_LINE}`],
    ["ri", `ri env:CLAUDECODE; ${KIT_LINE}`],
    ["an emptied variable", `$env:CLAUDECODE = ''; ${KIT_LINE}`],
    ["a null variable", `$env:CLAUDECODE=$null; ${KIT_LINE}`],
    ["a braced variable", `\${env:CLAUDECODE} = ''; ${KIT_LINE}`],
    ["Set-Item", `Set-Item Env:CLAUDECODE ''; ${KIT_LINE}`],
    [".NET", `[Environment]::SetEnvironmentVariable('CLAUDECODE', $null); ${KIT_LINE}`],
    ["a script block", `& { $env:CLAUDECODE = ''; ${KIT_LINE} }`],
    ["cmd /c set", `cmd /c "set CLAUDECODE= && ${KIT_LINE}"`],
  ])("PowerShell: %s", async (_name, command) => {
    const answer = await run(shellInput(command, repo, "PowerShell"));
    expect(answer?.decision).toBe("deny");
    expect(answer?.reason).toContain("with CLAUDECODE removed");
  });

  test("both reasons at once are both said", async () => {
    const answer = await run(shellInput(`env -u CLAUDECODE ${KIT} workflow review-done`, repo));
    expect(answer?.decision).toBe("deny");
    expect(answer?.reason).toContain("records a review by hand");
    expect(answer?.reason).toContain("with CLAUDECODE removed");
  });

  test.each([
    ["the kit command with CLAUDECODE left alone", `${KIT_LINE}`],
    ["a read of the variable", `echo $CLAUDECODE; ${KIT} doctor`],
    ["a test of the variable", `[ -n "$CLAUDECODE" ] && ${KIT} doctor`],
    ["another variable unset through env", `env -u FOO ${KIT} doctor`],
    ["another variable set through env", `env FOO=1 ${KIT} doctor`],
    ["another variable unset", `unset FOO; ${KIT} doctor`],
    ["another variable emptied", `FOO= ${KIT} doctor`],
    ["a PATH set through env", `env PATH=/usr/bin ${KIT} doctor`],
    ["nested claude, the usual idiom", `env -u CLAUDECODE claude -p "hi"`],
    ["a test run without it", `env -u CLAUDECODE bun test src/hooks`],
    ["a shell that unset it, then the kit outside it", `bash -c 'unset CLAUDECODE'; ${KIT} doctor`],
    ["unset alone", `unset CLAUDECODE`],
    ["a variable named like it", `env -u CLAUDECODE_OTHER ${KIT} doctor`],
    ["sudo for something else", `sudo apt-get update`],
    ["the kit's path only read", `env -u CLAUDECODE ls ~/.local/bin/${KIT}`],
    ["the kit's name only searched", `env -u CLAUDECODE grep -rn ${KIT} docs`],
    ["a commit message about it", `git commit -m "env -u CLAUDECODE ${KIT} doctor"`],
    ["the order: the kit before the unset", `${KIT} doctor; unset CLAUDECODE`],
  ])("not denied: %s", async (_name, command) => {
    expect(await run(shellInput(command, repo))).toBeNull();
  });

  test("a deny names the step to take, and is a deny, never an ask", async () => {
    const answer = await run(shellInput(`env -u CLAUDECODE ${KIT_LINE}`, repo));
    expect(answer?.reason).toBe(
      "This runs a cc-smart-dev-kit command with CLAUDECODE removed: it is unset. Claude Code sets CLAUDECODE for the commands it runs, and the commands that change this machine's settings (the workflow gate, the portal, updates) refuse to run while it is set, because they are for the person in their own terminal. Dropping it to get past that is not allowed. If the person wants the command run, they run it themselves.",
    );
  });
});

describe("the portal's port: asked", () => {
  const { repo } = makeClone();
  const PORT = DEFAULT_PORTAL_PORT;
  test("the port is the portal's default, from its one home", () => {
    expect(PORT).toBe(20_150);
  });

  test.each([
    `curl http://127.0.0.1:${PORT}/`,
    `curl -s localhost:${PORT}/api/state`,
    `curl -X POST http://LOCALHOST:${PORT}/action -d '{}'`,
    `curl http://[::1]:${PORT}/`,
    `curl http://127.1:${PORT}/`,
    `curl http://127.255.0.3:${PORT}/`,
    `curl http://0.0.0.0:${PORT}/`,
    `curl http://2130706433:${PORT}/`,
    `curl http://0x7f000001:${PORT}/`,
    `curl http://app.localhost:${PORT}/`,
    `nc localhost ${PORT}`,
    `exec 3<>/dev/tcp/127.0.0.1/${PORT}`,
    `wget -qO- http://127.0.0.1:${PORT}`,
    `python3 -c "import urllib.request as u; u.urlopen('http://localhost:${PORT}/')"`,
    `python3 -c "import socket; socket.create_connection(('localhost', ${PORT}))"`,
    `python3 <<'EOF'\nimport urllib.request\nurllib.request.urlopen("http://127.0.0.1:${PORT}")\nEOF`,
    `bash -c 'curl localhost:${PORT}'`,
    `echo go | xargs -I{} curl http://localhost:${PORT}/{}`,
  ])("%s", async (command) => {
    const answer = await run(shellInput(command, repo));
    expect(answer?.decision).toBe("ask");
    expect(answer?.reason).toBe(
      `This command reaches the portal's port (${PORT}) on this machine. The portal has no sign-in of its own: its pages change the gateway, the safety judge, updates and the workflow settings, the review gate included. It is for you, in your own browser. Allow this only if you asked for it.`,
    );
  });

  test("the PowerShell tool", async () => {
    const answer = await run(
      shellInput(`Invoke-RestMethod http://localhost:${PORT}/x`, repo, "PowerShell"),
    );
    expect(answer?.decision).toBe("ask");
  });

  test.each([
    `curl http://localhost:3000/`,
    `curl http://localhost:${PORT}0/`,
    `curl http://localhost:1${PORT}/`,
    `curl http://example.com:${PORT}/`,
    `curl http://10.127.0.1:${PORT}/`,
    `curl http://192.168.1.7:${PORT}/`,
    `curl http://notlocalhost:${PORT}/`,
    `curl http://localhost.example.com:${PORT}/`,
    `echo ${PORT}`,
    `ls localhost`,
    `bun test`,
  ])("a different address or port: %s", async (command) => {
    expect(await run(shellInput(command, repo))).toBeNull();
  });

  test("a deny wins over an ask in the same line", async () => {
    const answer = await run(
      shellInput(`env -u CLAUDECODE ${KIT} doctor; curl localhost:${PORT}`, repo),
    );
    expect(answer?.decision).toBe("deny");
  });
});

describe("an edit of the kit's own settings: asked", () => {
  const ASKED = /^This edit changes (.+): (.+)\. These files hold the limits/s;

  function asked(answer: ReturnType<typeof decisionOf>): { what: string; file: string } {
    expect(answer?.decision).toBe("ask");
    const match = ASKED.exec(answer?.reason ?? "");
    expect(match).not.toBeNull();
    return { what: match?.[1] ?? "", file: match?.[2] ?? "" };
  }

  const PROJECT = "the project's cc-smart-dev-kit settings (the workflow gate, which hooks run)";
  const SETTINGS = "the kit's own settings folder (the person's workflow and gateway settings)";
  const STATE = "the kit's own state folder (the review record, the ask log)";

  test.each(["Edit", "Write", "NotebookEdit"])(
    "%s of the project's file, in the main checkout",
    async (tool) => {
      const { repo } = makeClone();
      const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
      const got = asked(await run(editInput(file, repo, tool)));
      expect(got).toEqual({ what: PROJECT, file });
    },
  );

  test("a file that does not exist yet", async () => {
    const { repo } = makeClone();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    expect(asked(await run(editInput(file, repo))).file).toBe(file);
  });

  test("a relative path, from the input's cwd", async () => {
    const { repo } = makeClone();
    const got = asked(await run(editInput(".claude/cc-smart-dev-kit.json", repo)));
    expect(got.file).toBe(join(repo, ".claude", "cc-smart-dev-kit.json"));
  });

  test("a folder that is not a project at all: the file name and its folder decide", async () => {
    const folder = tempDir("not-a-repo");
    const file = join(folder, "x", ".claude", "cc-smart-dev-kit.json");
    expect(asked(await run(editInput(file, folder))).what).toBe(PROJECT);
  });

  test("a case-blind disk: the same file in other letters", async () => {
    const { repo } = makeClone();
    const file = join(repo, ".Claude", "CC-Smart-Dev-Kit.JSON");
    expect(asked(await run(editInput(file, repo))).what).toBe(PROJECT);
  });

  test("a Windows path, written with backslashes", async () => {
    const { repo } = makeClone();
    const got = asked(await run(editInput("C:\\code\\app\\.claude\\cc-smart-dev-kit.json", repo)));
    expect(got.what).toBe(PROJECT);
  });

  test("a file in the repo's own worktree folder, edited from the main checkout", async () => {
    const { repo, worktree } = repoWithWorktree();
    const file = join(worktree, ".claude", "cc-smart-dev-kit.json");
    // The session stands in the main checkout; the file is inside `.claude/worktrees/wt`.
    expect(asked(await run(editInput(file, repo))).file).toBe(file);
    // The same file named the long way round (a `..` through the main checkout).
    const roundabout = join(
      repo,
      "src",
      "..",
      ".claude",
      "worktrees",
      "wt",
      ".claude",
      "cc-smart-dev-kit.json",
    );
    expect(asked(await run(editInput(roundabout, repo))).file).toBe(file);
  });

  test("a subagent in its own worktree edits its own project file, and another worktree's", async () => {
    const { repo, worktree } = repoWithWorktree();
    const subagent = { agent_id: "0a1b2c3d4e5f60718", agent_type: "general-purpose" };
    const own = join(worktree, ".claude", "cc-smart-dev-kit.json");
    expect(asked(await run({ ...editInput(own, worktree, "Write"), ...subagent })).file).toBe(own);
    const main = join(repo, ".claude", "cc-smart-dev-kit.json");
    expect(asked(await run({ ...editInput(main, worktree, "Write"), ...subagent })).file).toBe(
      main,
    );
    // Its own source files are none of this guard's business.
    expect(
      await run({ ...editInput(join(worktree, "src", "a.ts"), worktree, "Write"), ...subagent }),
    ).toBeNull();
  });

  test("the person's settings folder: workflow.json, gateway.json, anything in it", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const repo = makeClone().repo;
    for (const file of [
      paths.workflowConfigFile,
      paths.gatewayConfigFile,
      join(dirname(paths.workflowConfigFile), "new-file.json"),
      join(dirname(paths.workflowConfigFile), "deeper", "x.json"),
    ]) {
      expect(asked(await run(editInput(file, repo, "Write"), env))).toEqual({
        what: SETTINGS,
        file,
      });
    }
  });

  test("`~` in the path means the home folder", async () => {
    const env = hookEnv();
    const repo = makeClone().repo;
    const got = asked(await run(editInput("~/.config/cc-smart-dev-kit/workflow.json", repo), env));
    expect(got.file).toBe(cliPaths(env).workflowConfigFile);
  });

  test("the kit's state folder: the review record, the ask log", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const repo = makeClone().repo;
    for (const file of [
      join(paths.stateDir, "reviews", "app-1234.json"),
      join(paths.stateDir, "guard-asks.jsonl"),
    ]) {
      expect(asked(await run(editInput(file, repo, "Write"), env))).toEqual({
        what: STATE,
        file,
      });
    }
  });

  test("a custom Claude config folder moves the state folder with it", async () => {
    const env = { ...hookEnv(), CLAUDE_CONFIG_DIR: join(tempDir("claude-config"), "cfg") };
    const repo = makeClone().repo;
    const file = join(env.CLAUDE_CONFIG_DIR, KIT, "reviews", "x.json");
    expect(asked(await run(editInput(file, repo, "Write"), env)).what).toBe(STATE);
  });

  test("a symlink to a settings file: the edit follows the link", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, "{}\n");
    const folder = tempDir("links");
    const link = join(folder, "notes.txt");
    symlinkSync(paths.workflowConfigFile, link);
    const got = asked(await run(editInput(link, folder, "Write"), env));
    expect(got.what).toBe(SETTINGS);
  });

  test("a symlinked folder that leads into the settings folder", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    const folder = tempDir("links");
    symlinkSync(dirname(paths.workflowConfigFile), join(folder, "cfg"));
    const got = asked(await run(editInput(join(folder, "cfg", "workflow.json"), folder), env));
    expect(got.what).toBe(SETTINGS);
  });

  test("a link named like the project file, pointing elsewhere: the name still counts", async () => {
    const { repo } = makeClone();
    const elsewhere = join(tempDir("elsewhere"), "settings.json");
    writeFileSync(elsewhere, "{}\n");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const link = join(repo, ".claude", "cc-smart-dev-kit.json");
    symlinkSync(elsewhere, link);
    expect(asked(await run(editInput(link, repo))).what).toBe(PROJECT);
  });

  test("a link that leads to a project file under another name", async () => {
    const { repo } = makeClone();
    const real = writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const folder = tempDir("links");
    const link = join(folder, "innocent.txt");
    symlinkSync(real, link);
    expect(asked(await run(editInput(link, folder, "Write"))).file).toBe(real);
  });

  test.each([
    ["a source file", (repo: string) => join(repo, "src", "a.ts")],
    ["the project's other settings", (repo: string) => join(repo, ".claude", "settings.json")],
    [
      "a skill's add-on in the kit's folder",
      (repo: string) => join(repo, ".claude", KIT, "review.md"),
    ],
    [
      "the name outside a .claude folder",
      (repo: string) => join(repo, "docs", "cc-smart-dev-kit.json"),
    ],
    [
      "a worktree's source",
      (repo: string) => join(repo, ".claude", "worktrees", "wt", "src", "a.ts"),
    ],
    ["a file in /tmp", () => join(tempDir("scratch"), "notes.md")],
  ])("silent: %s", async (_name, file) => {
    const { repo } = makeClone();
    expect(await run(editInput(file(repo), repo, "Write"))).toBeNull();
  });

  test("silent: another folder that starts with the kit's name", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const repo = makeClone().repo;
    const sibling = `${dirname(paths.workflowConfigFile)}-other`;
    expect(await run(editInput(join(sibling, "workflow.json"), repo, "Write"), env)).toBeNull();
    expect(
      await run(
        editInput(join(dirname(paths.workflowConfigFile), "..", "other", "x.json"), repo),
        env,
      ),
    ).toBeNull();
  });

  test("an input with no file at all", async () => {
    const { repo } = makeClone();
    expect(
      await run({ hook_event_name: "PreToolUse", cwd: repo, tool_name: "Write", tool_input: {} }),
    ).toBeNull();
  });
});

describe("a shell line that writes into the kit's own files: asked", () => {
  const TAIL =
    "These files hold the limits the kit's guards enforce, so a session that changes them changes its own limits. Allow it only if you asked for this change.";
  const PROJECT = "the project's cc-smart-dev-kit settings (the workflow gate, which hooks run)";
  const SETTINGS = "the kit's own settings folder (the person's workflow and gateway settings)";
  const STATE = "the kit's own state folder (the review record, the ask log)";

  // Temp folders go after each test, so every test builds its own.
  let env: Record<string, string>;
  let paths: ReturnType<typeof cliPaths>;
  let repo: string;
  let projectFile: string;
  let settingsDir: string;
  let stateFile: string;
  beforeEach(() => {
    env = hookEnv();
    paths = cliPaths(env);
    repo = join(tempDir("app"), "app");
    projectFile = writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, "{}\n");
    settingsDir = dirname(paths.workflowConfigFile);
    stateFile = join(paths.stateDir, "reviews", "app-1.json");
  });

  /** The answer for a line, run in `cwd` (the clone by default). */
  const ask = (command: string, tool = "Bash", cwd = repo) =>
    run(shellInput(command, cwd, tool), env);

  /** Each write form, written for a target `T`. */
  const BASH_FORMS: [string, (t: string) => string][] = [
    ["a redirect", (t) => `echo '{}' > ${t}`],
    ["an append", (t) => `echo '{}' >> ${t}`],
    ["a clobbering redirect", (t) => `echo '{}' >| ${t}`],
    ["a redirect of both streams", (t) => `echo '{}' &> ${t}`],
    ["a redirect with a file number", (t) => `echo '{}' 1> ${t}`],
    ["a redirect before the command", (t) => `>${t} echo '{}'`],
    ["a redirect with no space", (t) => `echo '{}'>${t}`],
    ["a here-doc into a file", (t) => `cat > ${t} <<'EOF'\n{}\nEOF`],
    ["a redirect in a nested shell", (t) => `bash -c "echo '{}' > ${t}"`],
    ["a redirect after another command", (t) => `git status && echo '{}' > ${t}`],
    ["tee", (t) => `echo '{}' | tee ${t}`],
    ["tee -a", (t) => `echo '{}' | tee -a ${t}`],
    ["tee with other files", (t) => `echo '{}' | tee /tmp/copy ${t} > /dev/null`],
    ["sudo tee", (t) => `echo '{}' | sudo tee ${t}`],
    ["sed -i", (t) => `sed -i 's/a/b/' ${t}`],
    ["sed -i with a suffix", (t) => `sed -i.bak 's/a/b/' ${t}`],
    ["sed -ni", (t) => `sed -ni 's/a/b/p' ${t}`],
    ["sed --in-place", (t) => `sed --in-place 's/a/b/' ${t}`],
    ["perl -pi", (t) => `perl -pi -e 's/a/b/' ${t}`],
    ["perl -i", (t) => `perl -i.orig -pe 's/a/b/' ${t}`],
    ["cp onto it", (t) => `cp /tmp/new.json ${t}`],
    ["cp -f onto it", (t) => `cp -f /tmp/new.json ${t}`],
    ["mv onto it", (t) => `mv /tmp/new.json ${t}`],
    ["mv away from it", (t) => `mv ${t} /tmp/gone.json`],
    ["install onto it", (t) => `install -m 600 /tmp/new.json ${t}`],
    ["ln onto it", (t) => `ln -sf /tmp/new.json ${t}`],
    ["dd of=", (t) => `dd if=/tmp/new.json of=${t}`],
    ["a command with a path in a quote", (t) => `echo '{}' > "${t}"`],
  ];
  const POWERSHELL_FORMS: [string, (t: string) => string][] = [
    ["a redirect", (t) => `echo '{}' > ${t}`],
    ["Set-Content", (t) => `Set-Content ${t} '{}'`],
    ["Set-Content -Path", (t) => `Set-Content -Path ${t} -Value '{}'`],
    ["Add-Content -LiteralPath", (t) => `Add-Content -LiteralPath ${t} '{}'`],
    ["sc", (t) => `sc ${t} '{}'`],
    ["Out-File", (t) => `'{}' | Out-File ${t}`],
    ["Out-File -FilePath", (t) => `'{}' | Out-File -FilePath ${t} -Encoding utf8`],
    ["Tee-Object", (t) => `Get-Date | Tee-Object -FilePath ${t}`],
    ["Copy-Item -Destination", (t) => `Copy-Item /tmp/new.json -Destination ${t}`],
    ["Copy-Item -Path -Destination", (t) => `Copy-Item -Path /tmp/new.json -Destination ${t}`],
    ["Copy-Item, an abbreviated parameter", (t) => `Copy-Item /tmp/new.json -Dest ${t}`],
    // The destination named first: the last word is the source, so only the parameter can tell.
    ["Copy-Item, the destination first", (t) => `Copy-Item -Destination ${t} /tmp/new.json`],
    ["Copy-Item, positional", (t) => `Copy-Item /tmp/new.json ${t}`],
    ["Move-Item -Destination", (t) => `Move-Item -Path /tmp/new.json -Destination ${t}`],
    ["Move-Item, positional", (t) => `Move-Item /tmp/new.json ${t}`],
    ["a script block", (t) => `& { Set-Content ${t} '{}' }`],
    ["pwsh -Command", (t) => `pwsh -Command "Set-Content ${t} '{}'"`],
  ];

  /** The protected files, by the name the test titles use; resolved when the test runs. */
  const TARGETS: [string, () => string, string][] = [
    ["the project file", () => projectFile, PROJECT],
    ["workflow.json", () => paths.workflowConfigFile, SETTINGS],
    ["gateway.json", () => paths.gatewayConfigFile, SETTINGS],
    ["a new file in the settings folder", () => join(settingsDir, "new.json"), SETTINGS],
    ["the review record", () => stateFile, STATE],
  ];

  describe.each(BASH_FORMS)("Bash: %s", (_name, form) => {
    test.each(TARGETS)("into %s: asks", async (_target, fileOf, what) => {
      const file = fileOf();
      const answer = await ask(form(file));
      expect(answer?.decision).toBe("ask");
      expect(answer?.reason).toContain(`This command writes into ${what}: `);
      expect(answer?.reason).toEndWith(`${file}. ${TAIL}`);
    });
    test("onto a normal file: passes", async () => {
      expect(await ask(form("/tmp/ordinary.txt"))).toBeNull();
    });
  });

  describe.each(POWERSHELL_FORMS)("PowerShell: %s", (_name, form) => {
    test.each(TARGETS)("into %s: asks", async (_target, fileOf, what) => {
      const answer = await ask(form(fileOf()), "PowerShell");
      expect(answer?.decision).toBe("ask");
      expect(answer?.reason).toContain(`This command writes into ${what}: `);
    });
    test("onto a normal file: passes", async () => {
      expect(await ask(form("/tmp/ordinary.txt"), "PowerShell")).toBeNull();
    });
  });

  test("a copy into a protected folder: -t, --target-directory, and the folder as the last word", async () => {
    for (const command of [
      `cp -t ${settingsDir} /tmp/new.json`,
      `cp -t${settingsDir} /tmp/new.json`,
      `cp --target-directory=${settingsDir} /tmp/new.json`,
      `cp --target-directory ${settingsDir} /tmp/new.json`,
      `cp /tmp/new.json ${settingsDir}/`,
      `mv /tmp/a.json /tmp/b.json ${settingsDir}`,
      `Copy-Item /tmp/new.json -Destination ${settingsDir}`,
    ]) {
      const tool = command.startsWith("Copy-Item") ? "PowerShell" : "Bash";
      const answer = await ask(command, tool);
      expect(answer?.reason).toContain(`This command writes into ${SETTINGS}: ${settingsDir}`);
    }
    // The project's `.claude` folder is not the project file: only a file named for it is.
    expect(await ask(`cp -t ${join(repo, ".claude")} /tmp/new.json`)).toBeNull();
    expect(await ask(`cp /tmp/new.json ${join(repo, ".claude")}/`)).toBeNull();
  });

  test("the reason is the Edit's reason with the command's first words, exactly", async () => {
    const edit = await run(editInput(projectFile, repo), env);
    const shell = await ask(`echo '{}' > ${projectFile}`);
    expect(edit?.reason).toBe(`This edit changes ${PROJECT}: ${projectFile}. ${TAIL}`);
    expect(shell?.reason).toBe(`This command writes into ${PROJECT}: ${projectFile}. ${TAIL}`);
  });

  test.each([
    ["cat", (t: string) => `cat ${t}`],
    ["grep", (t: string) => `grep -n reviewBeforePush ${t}`],
    ["head into a normal file", (t: string) => `head -5 ${t} > /tmp/out.txt`],
    ["cp from it", (t: string) => `cp ${t} /tmp/backup.json`],
    ["cp -f from it", (t: string) => `cp -f ${t} /tmp/backup.json`],
    ["cp -r from its folder", (t: string) => `cp -r ${dirname(t)} /tmp/backup`],
    ["sed without -i", (t: string) => `sed 's/a/b/' ${t}`],
    ["sed -n", (t: string) => `sed -n '/x/p' ${t}`],
    ["jq", (t: string) => `jq . ${t}`],
    ["diff", (t: string) => `diff ${t} /tmp/other.json`],
    ["ls", (t: string) => `ls -l ${t}`],
    ["stat", (t: string) => `stat ${t}`],
    ["a pipe to tee elsewhere", (t: string) => `cat ${t} | tee /tmp/copy.json`],
    ["a descriptor redirect", (t: string) => `cat ${t} 2>&1`],
    ["a descriptor redirect to stderr", (t: string) => `cat ${t} >&2`],
    ["a redirect from it", (t: string) => `wc -l < ${t}`],
    ["a here-string", (t: string) => `cat <<< ${t}`],
    ["dd with it as the input", (t: string) => `dd if=${t} of=/tmp/copy.bin`],
    ["git add of it", (t: string) => `git add ${t}`],
    ["a message that names it", (t: string) => `git commit -m "edit ${t} by hand"`],
    ["a quoted echo of its name", (t: string) => `echo "${t}"`],
  ])("a read passes: %s", async (_name, form) => {
    for (const [, file] of TARGETS) expect(await ask(form(file()))).toBeNull();
  });

  test.each([
    ["Get-Content", (t: string) => `Get-Content ${t}`],
    ["Copy-Item from it", (t: string) => `Copy-Item ${t} /tmp/backup.json`],
    [
      "Copy-Item -Path from it",
      (t: string) => `Copy-Item -Path ${t} -Destination /tmp/backup.json`,
    ],
    ["Select-String", (t: string) => `Select-String reviewBeforePush ${t}`],
    ["Get-Content into a normal file", (t: string) => `Get-Content ${t} | Out-File /tmp/out.txt`],
    ["a descriptor redirect", (t: string) => `Get-Content ${t} 2>&1`],
  ])("PowerShell, a read passes: %s", async (_name, form) => {
    for (const [, file] of TARGETS) expect(await ask(form(file()), "PowerShell")).toBeNull();
  });

  test.each([
    ["the project's other settings", () => `echo '{}' > ${join(repo, ".claude", "settings.json")}`],
    [
      "the name outside .claude",
      () => `echo '{}' > ${join(repo, "docs", "cc-smart-dev-kit.json")}`,
    ],
    ["a source file", () => `sed -i 's/a/b/' ${join(repo, "src", "a.ts")}`],
    [
      "a folder with the kit's name as a prefix",
      () => `echo x > ${settingsDir}-other/workflow.json`,
    ],
    ["a skill's add-on file", () => `echo x > ${join(repo, ".claude", KIT, "review.md")}`],
    ["the null device", () => "echo x > /dev/null"],
    ["a normal file", () => "tee /tmp/notes.txt < /dev/null"],
    ["cp to a normal file", () => "cp a.txt b.txt"],
    ["mv to a normal file", () => "mv a.txt b.txt"],
    ["dd to a normal file", () => "dd if=/dev/zero of=/tmp/zero.bin count=1"],
    ["a build", () => "bun run build > build.log 2>&1"],
  ])("a normal file passes: %s", async (_name, command) => {
    expect(await ask(command())).toBeNull();
  });

  describe("relative paths, and the folder the line is in", () => {
    test("relative to the input's cwd", async () => {
      const answer = await ask("echo '{}' > .claude/cc-smart-dev-kit.json");
      expect(answer?.reason).toContain(projectFile);
      const inSettings = await ask("echo '{}' > workflow.json", "Bash", settingsDir);
      expect(inSettings?.reason).toContain(paths.workflowConfigFile);
    });

    test("a `cd` moves the line", async () => {
      const answer = await ask(`cd ${settingsDir} && echo '{}' >> gateway.json`, "Bash", "/tmp");
      expect(answer?.reason).toContain(paths.gatewayConfigFile);
      const relative = await ask(`cd ${repo} && cd .claude && echo '{}' > cc-smart-dev-kit.json`);
      expect(relative?.reason).toContain(projectFile);
      const home = await ask(`cd ~/.config/${KIT} && echo '{}' > workflow.json`, "Bash", "/tmp");
      expect(home?.reason).toContain(paths.workflowConfigFile);
      const ps = await ask(
        `Set-Location ${settingsDir}; Set-Content workflow.json '{}'`,
        "PowerShell",
        "/tmp",
      );
      expect(ps?.reason).toContain(paths.workflowConfigFile);
    });

    test("a `cd` in a subshell does not hide the folder the line began in", async () => {
      const answer = await ask("(cd /tmp); echo '{}' > workflow.json", "Bash", settingsDir);
      expect(answer?.decision).toBe("ask");
    });

    test("`~` in a target means the home folder", async () => {
      const answer = await ask(`echo '{}' > ~/.config/${KIT}/workflow.json`, "Bash", "/tmp");
      expect(answer?.reason).toContain(paths.workflowConfigFile);
    });

    test("a case-blind spelling of the project file", async () => {
      const answer = await ask(`echo '{}' > ${repo}/.Claude/CC-Smart-Dev-Kit.JSON`);
      expect(answer?.decision).toBe("ask");
    });

    test("a Windows path, written with backslashes", async () => {
      const answer = await ask(
        "Set-Content C:\\code\\app\\.claude\\cc-smart-dev-kit.json '{}'",
        "PowerShell",
      );
      expect(answer?.reason).toContain(PROJECT);
    });
  });

  describe("a symlink on the way", () => {
    test("a link to workflow.json: the write follows it", async () => {
      const link = join(tempDir("links"), "notes.txt");
      symlinkSync(paths.workflowConfigFile, link);
      for (const command of [
        `echo x > ${link}`,
        `echo x | tee -a ${link}`,
        `sed -i s/a/b/ ${link}`,
        `cp /tmp/x ${link}`,
      ]) {
        const answer = await ask(command);
        expect(answer?.reason).toContain(
          `This command writes into ${SETTINGS}: ${paths.workflowConfigFile}`,
        );
      }
      const ps = await ask(`Set-Content ${link} x`, "PowerShell");
      expect(ps?.decision).toBe("ask");
    });

    test("a link to a folder of the kit's settings", async () => {
      const folder = tempDir("links");
      symlinkSync(settingsDir, join(folder, "cfg"));
      const answer = await ask(`echo x > ${join(folder, "cfg", "new.json")}`);
      expect(answer?.decision).toBe("ask");
    });

    test("a link to the project file under another name", async () => {
      const link = join(tempDir("links"), "innocent.txt");
      symlinkSync(projectFile, link);
      expect((await ask(`echo x > ${link}`))?.reason).toContain(`${PROJECT}: ${projectFile}`);
    });

    test("a link to a normal file passes", async () => {
      const normal = join(tempDir("links"), "real.txt");
      writeFileSync(normal, "x\n");
      const link = join(tempDir("links"), "alias.txt");
      symlinkSync(normal, link);
      expect(await ask(`echo x > ${link}`)).toBeNull();
    });
  });

  describe("a target the line works out when it runs", () => {
    test.each([
      ["a variable", "echo x > $OUT"],
      ["a variable in a path", 'echo x > "$HOME/out.txt"'],
      ["a command substitution", "echo x > $(mktemp)"],
      ["a backtick substitution", "echo x > `mktemp`"],
      ["a glob", "echo x > /tmp/out-*.txt"],
      ["tee to a variable", "echo x | tee $OUT"],
      ["cp to a variable", 'cp a.txt "$DEST"'],
      ["sed -i of a variable", "sed -i s/a/b/ $FILE"],
      ["a variable assigned on the line", "F=/tmp/out.txt; echo x > $F"],
      ["a variable in PowerShell", "$f = 'x.txt'; Set-Content $f hello"],
    ])("alone it passes: %s", async (_name, command) => {
      expect(await ask(command)).toBeNull();
    });

    test.each([
      ["a variable and the file name", () => `F=${paths.workflowConfigFile}; echo x > $F`],
      ["the project file named, a variable written", () => `echo x > "$ROOT/.claude/${KIT}.json"`],
      ["the home folder as a variable", () => `echo x > "$HOME/.config/${KIT}/workflow.json"`],
      ["the state folder as text", () => `echo x | tee "$S/.claude/${KIT}/guard-asks.jsonl"`],
      [
        "the file named in a read, the target computed",
        () => `cat ${paths.workflowConfigFile} > $OUT`,
      ],
      ["a command substitution", () => `echo x > $(echo ${paths.workflowConfigFile})`],
      [
        "a Windows path in the text",
        () => `echo x > $DIR\\x.json ; echo .config\\${KIT}\\workflow.json`,
      ],
    ])("it names a protected file by text: asks (%s)", async (_name, command) => {
      const answer = await ask(command());
      expect(answer?.decision).toBe("ask");
      expect(answer?.reason).toContain("writes to a path it works out when it runs");
      expect(answer?.reason).toEndWith(TAIL);
    });

    test("PowerShell: a variable and the file named", async () => {
      const answer = await ask(
        `$f = '${paths.workflowConfigFile}'; Set-Content $f hello`,
        "PowerShell",
      );
      expect(answer?.reason).toContain("writes to a path it works out when it runs");
    });

    test("a relative target after a `cd` the reader cannot follow is computed too", async () => {
      expect(await ask('cd "$DIR" && echo x > out.txt')).toBeNull();
      const named = await ask(`cd "$DIR" && echo x > out.txt # ${KIT}.json`);
      expect(named?.decision).toBe("ask");
    });
  });

  test("two writes, two questions; a deny still wins", async () => {
    const two = await ask(`echo x > ${paths.workflowConfigFile}; echo y > ${projectFile}`);
    expect(two?.reason.split("\n")).toHaveLength(2);
    const denied = await ask(`env -u CLAUDECODE ${KIT} doctor; echo x > ${projectFile}`);
    expect(denied?.decision).toBe("deny");
  });

  test("the portal's question and a write's come together", async () => {
    const both = await ask(`curl localhost:${DEFAULT_PORTAL_PORT}; echo x > ${projectFile}`);
    expect(both?.decision).toBe("ask");
    expect(both?.reason).toContain("reaches the portal's port");
    expect(both?.reason).toContain("This command writes into");
  });

  test("outside git, and with a broken project file, it still asks", async () => {
    const folder = tempDir("no-git");
    const loose = await run(
      shellInput(`echo x > ${join(folder, ".claude", "cc-smart-dev-kit.json")}`, folder),
    );
    expect(loose?.decision).toBe("ask");
    const { repo: broken } = makeClone();
    writeClaudeFile(broken, "cc-smart-dev-kit.json", { worktree: {} });
    const answer = await run(
      shellInput(`echo x > ${broken}/.claude/cc-smart-dev-kit.json`, broken),
    );
    expect(answer?.decision).toBe("ask");
  });

  test("a subagent in its own worktree writing the main checkout's project file", async () => {
    const { repo: main, worktree } = repoWithWorktree();
    const subagent = { agent_id: "0a1b2c3d4e5f60718", agent_type: "general-purpose" };
    const file = join(main, ".claude", "cc-smart-dev-kit.json");
    const answer = await run({ ...shellInput(`echo '{}' > ${file}`, worktree), ...subagent });
    expect(answer?.reason).toContain(file);
    const own = await run({
      ...shellInput("echo '{}' > .claude/cc-smart-dev-kit.json", worktree),
      ...subagent,
    });
    expect(own?.reason).toContain(join(worktree, ".claude", "cc-smart-dev-kit.json"));
  });

  test("a 64 KB line of writes stays inside the guard's time", async () => {
    const long = `${"echo hello > /tmp/out.txt; ".repeat(2_500)}echo x > ${projectFile}`;
    expect(long.length).toBeGreaterThan(64_000);
    const started = performance.now();
    const answer = await ask(long);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(answer?.decision).toBe("ask");
  });
});

describe("machine-wide: the project does not change the answer", () => {
  const DENIED = `env -u CLAUDECODE ${KIT} doctor`;

  test("outside git", async () => {
    const folder = tempDir("no-git");
    expect((await run(shellInput(DENIED, folder)))?.decision).toBe("deny");
    const file = join(folder, ".claude", "cc-smart-dev-kit.json");
    expect((await run(editInput(file, folder)))?.decision).toBe("ask");
  });

  test("a folder that does not exist", async () => {
    expect((await run(shellInput(DENIED, join(tempDir("gone"), "missing"))))?.decision).toBe(
      "deny",
    );
  });

  test("an input with no cwd", async () => {
    const input = shellInput(DENIED, "/");
    delete input.cwd;
    expect((await run(input))?.decision).toBe("deny");
    const edit = editInput("/x/.claude/cc-smart-dev-kit.json", "/");
    delete edit.cwd;
    expect((await run(edit))?.decision).toBe("ask");
  });

  test("a project file that is broken, or needs a newer plugin", async () => {
    for (const config of [{ worktree: {} }, { requires: ">=99" }]) {
      const { repo } = makeClone();
      writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
      expect((await run(shellInput(DENIED, repo)))?.decision).toBe("deny");
    }
    const { repo } = makeClone();
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    expect((await run(shellInput(DENIED, repo)))?.decision).toBe("deny");
  });

  test("ownHooks cannot switch it off: its name is not accepted, and the guard judges on", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["session-escape-guard"] });
    // The strict parse refuses the name, so the frame hands the call to `onConfigProblem`,
    // which judges it like `run` does.
    expect((await run(shellInput(DENIED, repo)))?.decision).toBe("deny");
  });

  test("the frame skips its ownHooks step for an alwaysOn hook, and only for one", async () => {
    // A name `ownHooks` accepts, so the file parses and only the frame's own step is at play.
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-guard"] });
    const input = shellInput(DENIED, repo);
    const named = { ...sessionEscapeGuardHook, name: "git-guard" };
    expect(decisionOf(await runHook(named, input, hookEnv()))?.decision).toBe("deny");
    expect(await runHook({ ...named, alwaysOn: false }, input, hookEnv())).toEqual({});
  });

  test("ownHooks naming the other hooks silences none of this guard", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ownHooks: ["git-guard", "merge-guard", "main-folder-guard", "agent-guard"],
    });
    expect((await run(shellInput(DENIED, repo)))?.decision).toBe("deny");
  });

  test("the project's own settings may wire hooks of its own: still answers", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "settings.json", {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }] },
    });
    expect((await run(shellInput(DENIED, repo)))?.decision).toBe("deny");
  });

  test("a worktree of a project: the same", async () => {
    const { worktree } = repoWithWorktree();
    expect((await run(shellInput(DENIED, worktree)))?.decision).toBe("deny");
  });
});

describe("other events and tools", () => {
  test("a tool it does not judge is silent, whatever it carries", async () => {
    const { repo } = makeClone();
    expect(
      await run({
        hook_event_name: "PreToolUse",
        cwd: repo,
        tool_name: "Read",
        tool_input: { file_path: join(repo, ".claude", "cc-smart-dev-kit.json") },
      }),
    ).toBeNull();
    expect(
      await run({
        hook_event_name: "PreToolUse",
        cwd: repo,
        tool_name: "Agent",
        tool_input: { command: `env -u CLAUDECODE ${KIT} doctor` },
      }),
    ).toBeNull();
  });

  test("another event is none of its business", async () => {
    const { repo } = makeClone();
    const input = {
      ...shellInput(`env -u CLAUDECODE ${KIT} doctor`, repo),
      hook_event_name: "PostToolUse",
    };
    expect(await run(input)).toBeNull();
  });

  test("an empty command, or none", async () => {
    const { repo } = makeClone();
    expect(await run(shellInput("", repo))).toBeNull();
    expect(
      await run({ hook_event_name: "PreToolUse", cwd: repo, tool_name: "Bash", tool_input: {} }),
    ).toBeNull();
  });

  test("a 64 KB line stays inside the guard's time", async () => {
    const { repo } = makeClone();
    const long = `${"echo hello world; ".repeat(3_700)}env -u CLAUDECODE ${KIT} doctor`;
    expect(long.length).toBeGreaterThan(64_000);
    const started = performance.now();
    const answer = await run(shellInput(long, repo));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(answer?.decision).toBe("deny");
  });
});

describe("its crash answer: fail closed", () => {
  const throws = {
    ...sessionEscapeGuardHook,
    run: () => {
      throw new Error("boom");
    },
  };

  test("a crash asks about an edit", async () => {
    const { repo } = makeClone();
    const answer = decisionOf(
      await runHook(throws, editInput(join(repo, "src", "a.ts"), repo, "Write"), hookEnv()),
    );
    expect(answer).toEqual({
      decision: "ask",
      reason:
        "cc-smart-dev-kit cannot check whether this call goes around the limits set for the session: boom",
    });
  });

  test.each([
    `${KIT} workflow review-done`,
    `env -u CLAUDECODE bun test`,
    `curl localhost:${DEFAULT_PORTAL_PORT}`,
    `bun /x/dist/cli.js doctor`,
    `$env:claudecode = ''`,
  ])("a crash asks about a line in its domain: %s", async (command) => {
    const { repo } = makeClone();
    const answer = decisionOf(await runHook(throws, shellInput(command, repo), hookEnv()));
    expect(answer?.decision).toBe("ask");
  });

  test("a crash says nothing about a line outside its domain", async () => {
    const { repo } = makeClone();
    expect(decisionOf(await runHook(throws, shellInput("ls -la", repo), hookEnv()))).toBeNull();
    expect(
      decisionOf(
        await runHook(throws, { ...shellInput("ls", repo), tool_name: "Read" }, hookEnv()),
      ),
    ).toBeNull();
  });

  test("a crash outside git asks too: the judgment there can crash as well", async () => {
    const outside = {
      ...sessionEscapeGuardHook,
      outsideGit: () => {
        throw new Error("boom");
      },
    };
    const folder = tempDir("no-git");
    const answer = decisionOf(
      await runHook(outside, editInput(join(folder, "a.ts"), folder, "Write"), hookEnv()),
    );
    expect(answer?.decision).toBe("ask");
    expect(answer?.reason).toEndWith(": boom");
  });

  test("a hook input that is not JSON asks, in general", async () => {
    const result = await handleHook(sessionEscapeGuardHook, "not json", hookEnv());
    expect(decisionOf(result)).toEqual({
      decision: "ask",
      reason:
        "cc-smart-dev-kit cannot check whether this call goes around the limits set for the session: the hook input is not JSON",
    });
  });

  test("the crash domain reads text, not commands (the reader may be what crashed)", () => {
    const input = (command: string): HookInput => ({ tool_name: "Bash", tool_input: { command } });
    expect(inEscapeDomain(input("echo CLAUDECODE"))).toBe(true);
    expect(inEscapeDomain(input("ls"))).toBe(false);
    expect(inEscapeDomain({ tool_name: "NotebookEdit", tool_input: {} })).toBe(true);
    expect(inEscapeDomain({ tool_name: "Grep", tool_input: {} })).toBe(false);
  });
});

describe("as Claude Code runs it: the entry, over stdin", () => {
  test("a deny, exactly", () => {
    const { repo } = makeClone();
    const run = runEntry(
      "session-escape-guard",
      JSON.stringify(shellInput(`${KIT} workflow review-done`, repo)),
      hookEnv(),
    );
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    const output = JSON.parse(run.stdout).hookSpecificOutput;
    expect(output.hookEventName).toBe("PreToolUse");
    expect(output.permissionDecision).toBe("deny");
  });

  test("silence is empty output and exit 0", () => {
    const { repo } = makeClone();
    expect(
      runEntry("session-escape-guard", JSON.stringify(shellInput("ls", repo)), hookEnv()),
    ).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });
});

describe("the direct call", () => {
  test("sessionEscapeGuard takes the input and the paths, and nothing else", () => {
    const env = hookEnv();
    const result = sessionEscapeGuard(shellInput(`sudo ${KIT} doctor`, "/"), cliPaths(env));
    expect(decisionOf(result)?.decision).toBe("deny");
  });
});
