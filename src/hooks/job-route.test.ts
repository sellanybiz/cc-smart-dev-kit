/**
 * The job-route hook (`job-route.ts`): which heavy command goes through the queue, and the
 * exact command line it becomes — plain commands as argv words, everything else through
 * `/bin/sh -c`. Plus the two answers: a rewrite (`updatedInput`) and, if a Claude Code ever
 * ignores that, a denial naming the command.
 */
import { describe, expect, it } from "bun:test";
import { mergeKinds } from "../jobs/kinds";
import {
  jobRunCommand,
  rewriteAnswer,
  routeDenial,
  routeHeavyCommand,
  runsJobRun,
} from "./job-route";

const KINDS = mergeKinds(undefined);
const LAUNCHER = '"$HOME/.local/bin/anymodel"';

describe("which commands are routed", () => {
  it("a heavy command of a default kind is routed; a light one is not", () => {
    expect(routeHeavyCommand("bunx vitest run src/a.test.ts", KINDS)).toEqual({
      command: `${LAUNCHER} job run --kind test:run -- bunx vitest run src/a.test.ts`,
      kind: "test:run",
    });
    expect(routeHeavyCommand("bunx tsc --noEmit", KINDS)?.kind).toBe("tsc");
    expect(routeHeavyCommand("npx next build", KINDS)?.kind).toBe("build");
    expect(routeHeavyCommand("bunx vitest run --coverage", KINDS)?.kind).toBe("test:coverage");
    expect(routeHeavyCommand("ls -la", KINDS)).toBeNull();
    expect(routeHeavyCommand("git status", KINDS)).toBeNull();
    // A print-only run reserves nothing, so it is not heavy.
    expect(routeHeavyCommand("bunx tsc --version", KINDS)).toBeNull();
    // A package.json script is matched only by a kind's own `script` rule.
    expect(routeHeavyCommand("bun run build", KINDS)).toBeNull();
  });

  it("the project's own kinds are used, over the defaults", () => {
    const kinds = mergeKinds({ build: { gb: 14, match: [{ script: "build" }] } });
    expect(routeHeavyCommand("bun run build", kinds)).toEqual({
      command: `${LAUNCHER} job run --kind build -- bun run build`,
      kind: "build",
    });
    expect(routeHeavyCommand("bun run build", KINDS)).toBeNull();
  });

  it("what is already queued stays as it is", () => {
    expect(runsJobRun(`${LAUNCHER} job run --kind tsc -- bun run tsc`)).toBe(true);
    expect(runsJobRun("anymodel job run --kind tsc -- bun run tsc")).toBe(true);
    expect(runsJobRun("~/.local/bin/anymodel job run --kind tsc -- bun run tsc")).toBe(true);
    expect(runsJobRun(`sh -c "${LAUNCHER} job run --kind tsc -- bun run tsc"`)).toBe(true);
    expect(runsJobRun("anymodel job status")).toBe(false);
    expect(runsJobRun("bun run tsc")).toBe(false);
    expect(routeHeavyCommand(`${LAUNCHER} job run --kind tsc -- bun run tsc`, KINDS)).toBeNull();
    // The line the guard is really for: it queues one heavy command AND runs another one the
    // classifier knows. Rewriting it would nest the queue inside the queue, so it stays.
    expect(
      routeHeavyCommand(
        `${LAUNCHER} job run --kind test:run -- bunx vitest run; bunx tsc --noEmit`,
        KINDS,
      ),
    ).toBeNull();
  });

  it("a plain command goes in as its own words; a compound one through a shell", () => {
    expect(jobRunCommand("tsc", "bunx tsc --noEmit")).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`,
    );
    // A quoted word with a space stays one word: quoted again for the shell.
    expect(jobRunCommand("tsc", 'bunx tsc --project "my dir/tsconfig.json"')).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --project 'my dir/tsconfig.json'`,
    );
    expect(jobRunCommand("tsc", "bunx tsc --noEmit && echo ok")).toBe(
      `${LAUNCHER} job run --kind tsc -- sh -c 'bunx tsc --noEmit && echo ok'`,
    );
    expect(jobRunCommand("build", "npx next build | tail -5")).toContain(
      "sh -c 'npx next build | tail -5'",
    );
    expect(jobRunCommand("tsc", "$(which tsc) --noEmit")).toContain(
      "sh -c '$(which tsc) --noEmit'",
    );
    // A quote inside the command cannot end the quoted string.
    expect(jobRunCommand("build", `npx next build && echo "it's done"`)).toBe(
      `${LAUNCHER} job run --kind build -- sh -c 'npx next build && echo "it'\\''s done"'`,
    );
    // A glob, a leading variable, an assignment, a wrapper or a redirect is not a plain word.
    expect(jobRunCommand("test:run", "bunx vitest run src/*.test.ts")).toContain("sh -c ");
    expect(jobRunCommand("tsc", "VAR=1 bunx tsc")).toContain("sh -c ");
    expect(jobRunCommand("tsc", "time bunx tsc")).toContain("sh -c ");
    expect(jobRunCommand("tsc", "bunx tsc --noEmit > out.txt")).toContain("sh -c ");
  });

  it("a nested heavy command in a shell string is routed too (the whole line goes)", () => {
    expect(routeHeavyCommand("sh -c 'bunx vitest run'", KINDS)?.kind).toBe("test:run");
    expect(routeHeavyCommand('bash -c "npx next build"', KINDS)?.kind).toBe("build");
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
