/**
 * The job-route hook (`job-route.ts`): which heavy command goes through the queue, and the
 * exact command line it becomes — plain commands as argv words, everything else through the
 * person's own shell. Plus the two answers: a rewrite (`updatedInput`) and, if a Claude Code
 * ever ignores that, a denial naming the command.
 */
import { describe, expect, it } from "bun:test";
import { mergeKinds } from "../jobs/kinds";
import {
  jobRunCommand,
  rewriteAnswer,
  routeDenial,
  routedShell,
  routeHeavyCommand,
  runsJobRun,
} from "./job-route";

const KINDS = mergeKinds(undefined);
const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';
/** The person's shell, as the hook finds it; every routed shell line goes through it. */
const SHELL = "/bin/bash";

describe("which commands are routed", () => {
  it("a heavy command of a default kind is routed; a light one is not", () => {
    expect(routeHeavyCommand("bunx vitest run src/a.test.ts", KINDS, SHELL)).toEqual({
      command: `${LAUNCHER} job run --kind test:run -- bunx vitest run src/a.test.ts`,
      kind: "test:run",
    });
    expect(routeHeavyCommand("bunx tsc --noEmit", KINDS, SHELL)?.kind).toBe("tsc");
    expect(routeHeavyCommand("npx next build", KINDS, SHELL)?.kind).toBe("build");
    expect(routeHeavyCommand("bunx vitest run --coverage", KINDS, SHELL)?.kind).toBe(
      "test:coverage",
    );
    expect(routeHeavyCommand("ls -la", KINDS, SHELL)).toBeNull();
    expect(routeHeavyCommand("git status", KINDS, SHELL)).toBeNull();
    // A print-only run reserves nothing, so it is not heavy.
    expect(routeHeavyCommand("bunx tsc --version", KINDS, SHELL)).toBeNull();
    // A package.json script is matched only by a kind's own `script` rule.
    expect(routeHeavyCommand("bun run build", KINDS, SHELL)).toBeNull();
  });

  it("the project's own kinds are used, over the defaults", () => {
    const kinds = mergeKinds({ build: { gb: 14, match: [{ script: "build" }] } });
    expect(routeHeavyCommand("bun run build", kinds, SHELL)).toEqual({
      command: `${LAUNCHER} job run --kind build -- bun run build`,
      kind: "build",
    });
    expect(routeHeavyCommand("bun run build", KINDS, SHELL)).toBeNull();
  });

  it("what is already queued stays as it is", () => {
    expect(runsJobRun(`${LAUNCHER} job run --kind tsc -- bun run tsc`)).toBe(true);
    expect(runsJobRun("cc-smart-dev-kit job run --kind tsc -- bun run tsc")).toBe(true);
    expect(runsJobRun("~/.local/bin/cc-smart-dev-kit job run --kind tsc -- bun run tsc")).toBe(
      true,
    );
    expect(runsJobRun(`sh -c "${LAUNCHER} job run --kind tsc -- bun run tsc"`)).toBe(true);
    expect(runsJobRun("cc-smart-dev-kit job status")).toBe(false);
    expect(runsJobRun("bun run tsc")).toBe(false);
    expect(
      routeHeavyCommand(`${LAUNCHER} job run --kind tsc -- bun run tsc`, KINDS, SHELL),
    ).toBeNull();
    // The line the guard is really for: it queues one heavy command AND runs another one the
    // classifier knows. Rewriting it would nest the queue inside the queue, so it stays.
    expect(
      routeHeavyCommand(
        `${LAUNCHER} job run --kind test:run -- bunx vitest run; bunx tsc --noEmit`,
        KINDS,
        SHELL,
      ),
    ).toBeNull();
  });

  it("a plain command goes in as its own words; a compound one through the person's shell", () => {
    expect(jobRunCommand("tsc", "bunx tsc --noEmit", SHELL)).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`,
    );
    // A quoted word with a space stays one word: quoted again for the shell.
    expect(jobRunCommand("tsc", 'bunx tsc --project "my dir/tsconfig.json"', SHELL)).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --project 'my dir/tsconfig.json'`,
    );
    // The whole line goes through the shell the person's session runs: never `/bin/sh`,
    // which is dash on Debian and Ubuntu and reads bash syntax differently.
    expect(jobRunCommand("tsc", "bunx tsc --noEmit && echo ok", "/bin/bash")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bunx tsc --noEmit && echo ok'`,
    );
    expect(jobRunCommand("tsc", "[[ -f x ]] && source .env && bunx tsc", "/usr/bin/zsh")).toBe(
      `${LAUNCHER} job run --kind tsc -- /usr/bin/zsh -c '[[ -f x ]] && source .env && bunx tsc'`,
    );
    expect(jobRunCommand("build", "npx next build | tail -5", SHELL)).toContain(
      `/bin/bash -c 'npx next build | tail -5'`,
    );
    expect(jobRunCommand("tsc", "$(which tsc) --noEmit", SHELL)).toContain(
      `/bin/bash -c '$(which tsc) --noEmit'`,
    );
    // A quote inside the command cannot end the quoted string.
    expect(jobRunCommand("build", `npx next build && echo "it's done"`, SHELL)).toBe(
      `${LAUNCHER} job run --kind build -- /bin/bash -c 'npx next build && echo "it'\\''s done"'`,
    );
    // A glob, a leading variable, an assignment, a wrapper or a redirect is not a plain word.
    expect(jobRunCommand("test:run", "bunx vitest run src/*.test.ts", SHELL)).toContain("-c ");
    expect(jobRunCommand("tsc", "VAR=1 bunx tsc", SHELL)).toContain("-c ");
    expect(jobRunCommand("tsc", "time bunx tsc", SHELL)).toContain("-c ");
    expect(jobRunCommand("tsc", "bunx tsc --noEmit > out.txt", SHELL)).toContain("-c ");
  });

  it("the shell is the person's own: $SHELL when it is bash or zsh, else bash, else sh", () => {
    const found = (path: string) => () => path;
    expect(routedShell({ SHELL: "/bin/bash" }, found("/usr/bin/bash"))).toBe("/bin/bash");
    expect(routedShell({ SHELL: "/usr/bin/zsh" }, found("/usr/bin/zsh"))).toBe("/usr/bin/zsh");
    // A login shell that is neither (dash, fish, a Windows shell): bash where it is.
    expect(routedShell({ SHELL: "/bin/dash" }, found("/usr/bin/bash"))).toBe("/usr/bin/bash");
    expect(routedShell({ SHELL: "" }, found("/usr/bin/bash"))).toBe("/usr/bin/bash");
    // No bash anywhere: the smallest shell every machine has.
    expect(routedShell({}, found("/nowhere"))).toBe("/nowhere");
    expect(routedShell({}, () => null)).toBe("sh");
  });

  it("a nested heavy command in a shell string is routed too (the whole line goes)", () => {
    expect(routeHeavyCommand("sh -c 'bunx vitest run'", KINDS, SHELL)?.kind).toBe("test:run");
    expect(routeHeavyCommand('bash -c "npx next build"', KINDS, SHELL)?.kind).toBe("build");
  });
});

describe("the two answers", () => {
  const routed = { command: `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`, kind: "tsc" };

  it("the rewrite: the same tool input, its command replaced, no permission decision", () => {
    const answer = JSON.parse(
      rewriteAnswer({ command: "bunx tsc --noEmit", timeout: 120000 }, routed).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer).toEqual({
      hookEventName: "PreToolUse",
      updatedInput: { command: routed.command, timeout: 120000 },
    });
  });

  it("the denial names the exact command to run instead", () => {
    const answer = JSON.parse(routeDenial(routed).stdout ?? "{}").hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain(routed.command);
    expect(answer.permissionDecisionReason).toContain("heavy command (tsc)");
  });
});
