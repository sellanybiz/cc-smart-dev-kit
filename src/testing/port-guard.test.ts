/**
 * The live-router guard itself: a call to port 20100 never leaves the process, in this
 * process or in a guarded subprocess, and is recorded so the test that made it fails.
 * Each test here takes the recorded calls itself, so the preload's check finds none.
 */
import { describe, expect, it } from "bun:test";
import { GUARD_EXIT_CODE, isGuardedUrl, subprocessGuard, takeViolations } from "./port-guard";

describe("the live-router guard", () => {
  it("knows the guarded addresses, and only those", () => {
    expect(isGuardedUrl("http://127.0.0.1:20100/__cc-smart-dev-kit/health")).toBe(true);
    expect(isGuardedUrl("http://localhost:20100/v1/messages")).toBe(true);
    expect(isGuardedUrl("http://[::1]:20100/")).toBe(true);
    expect(isGuardedUrl(new URL("http://127.0.0.1:20100/x"))).toBe(true);
    expect(isGuardedUrl(new Request("http://127.0.0.1:20100/x"))).toBe(true);
    expect(isGuardedUrl("http://127.0.0.1:20101/")).toBe(false);
    expect(isGuardedUrl("http://example.test:20100/")).toBe(false);
    expect(isGuardedUrl("not a url")).toBe(false);
  });

  it("refuses a fetch to 127.0.0.1:20100 in this process, before anything is sent", async () => {
    let refused: unknown = null;
    try {
      await fetch("http://127.0.0.1:20100/__cc-smart-dev-kit/health");
    } catch (error) {
      refused = error;
    }
    expect(String(refused)).toContain(
      "port guard: a test tried to reach the live router port: http://127.0.0.1:20100/__cc-smart-dev-kit/health",
    );
    // Recorded although the error was caught: the preload fails such a test.
    expect(takeViolations()).toEqual([
      "a test tried to reach the live router port: http://127.0.0.1:20100/__cc-smart-dev-kit/health",
    ]);
  });

  it("a guarded subprocess exits at once and logs the call, though its code catches the error", async () => {
    const guard = subprocessGuard();
    const script =
      'try { await fetch("http://localhost:20100/x"); } catch {} console.log("went on");';
    const proc = Bun.spawn([process.execPath, ...guard.args, "-e", script], {
      env: { ...guard.env, PATH: "" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(GUARD_EXIT_CODE);
    expect(stdout).toBe("");
    expect(takeViolations()).toEqual([
      "a test tried to reach the live router port: http://localhost:20100/x",
    ]);
  });
});
