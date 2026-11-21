/**
 * A git that never answers, seen from the commands that find the project's checkout
 * (`locateCheckout`, `src/project/resolve.ts`): each says so in one plain line that carries its fix,
 * and none prints a stack. The call throws when git times out, where it once answered "outside
 * git" (RV4-2), so every caller's catch is part of what a person reads.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";

setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/** What every one of them says, written by hand: the reason, then what to do. */
const SAYS =
  "git did not answer in time: run `git status` in this folder; if that hangs too, fix git first, then run this again";

describe("a git that never answers", () => {
  test.skipIf(process.platform === "win32")(
    "each command that finds the checkout says so in one plain line with its fix, and no stack",
    async () => {
      const root = tempDir("git-timeout");
      const home = join(root, "home");
      const repo = join(root, "app");
      mkdirSync(home);
      mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      mkdirSync(join(repo, ".claude"));
      writeFileSync(
        join(repo, ".claude", "cc-smart-dev-kit.json"),
        '{ "requires": ">=0.4", "worktrees": { "base": "main" } }\n',
      );
      // A git that hangs on every call: `exec` makes the sleep the process the timeout stops.
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "git"), "#!/bin/sh\nexec sleep 60\n");
      chmodSync(join(bin, "git"), 0o755);
      const guard = subprocessGuard();
      const run = async (args: string[]) => {
        const child = Bun.spawn([process.execPath, ...guard.args, CLI, ...args], {
          cwd: repo,
          env: {
            ...guard.env,
            PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
            HOME: home,
            CLAUDE_CONFIG_DIR: join(home, ".claude"),
            NO_COLOR: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, stderr, stdout };
      };
      // All at once: each waits out its own 5 s, so the test costs one.
      const commands: { args: string[]; stderr: string; exitCode: number }[] = [
        {
          args: ["project", "init", "--dry-run", "--yes"],
          exitCode: 1,
          stderr: `cc-smart-dev-kit project init: ${SAYS}\n`,
        },
        {
          args: ["workflow", "set", "allowCommit", "true", "--project"],
          exitCode: 1,
          stderr: `${SAYS}\n`,
        },
        {
          args: ["workflow", "review-done", "--sha", "abc1234"],
          exitCode: 1,
          stderr: `cc-smart-dev-kit workflow review-done: ${SAYS}\n`,
        },
        // The command's own catch-all: the uncaught throw is one line, not a stack.
        { args: ["worktrees"], exitCode: 1, stderr: `cc-smart-dev-kit: ${SAYS}\n` },
      ];
      const answers = await Promise.all(commands.map((command) => run(command.args)));
      for (const [at, command] of commands.entries()) {
        const answer = answers[at];
        expect({
          args: command.args,
          exitCode: answer?.exitCode,
          stderr: answer?.stderr,
          stdout: answer?.stdout,
        }).toEqual({
          args: command.args,
          exitCode: command.exitCode,
          stderr: command.stderr,
          stdout: "",
        });
      }

      // The ones that answer on stdout: a note in the page's JSON, and doctor's failed line.
      const [json, doctor] = await Promise.all([run(["worktrees", "--json"]), run(["doctor"])]);
      expect(JSON.parse(json.stdout)).toEqual({
        autoClean: null,
        base: "",
        from: "default",
        note: SAYS,
        worktrees: [],
      });
      expect(json.stderr).toBe("");
      // Its check says what is wrong and prints the fix on the next line, so the reason alone.
      expect(doctor.stdout).toContain("✗ project: git did not answer in time\n");
      expect(doctor.stdout).toContain(
        "Fix: check that git works in this folder (git status), then run: cc-smart-dev-kit doctor\n",
      );
      expect(doctor.stdout).not.toMatch(/^\s+at /m);
      expect(doctor.stderr).toBe("");
    },
  );
});
