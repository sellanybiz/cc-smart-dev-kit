/**
 * `browserCheckCommand` and the prerequisites the live check insists on before it starts anything.
 * The check itself drives the person's own Chrome through the Playwright extension, so it is run by
 * hand (`cc-smart-dev-kit browser check`); everything that DECIDES whether to run it is pure, and
 * tested here.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromeWorld, writeWorldToken } from "../testing/chrome-world";
import { tempDir } from "../testing/temp";
import { browserCheckCommand, checkPrerequisites, fileUrlHint, runBrowserCheck } from "./check";

describe("browserCheckCommand", () => {
  test("this bun, the plugin's two flags, and this bundle", () => {
    expect(
      browserCheckCommand(
        "/opt/bun/bin/bun",
        "/plugins/cc-smart-dev-kit/dist/cli.js",
        "/plugins/cc-smart-dev-kit",
      ),
    ).toEqual([
      "/opt/bun/bin/bun",
      "--no-env-file",
      "--config=/plugins/cc-smart-dev-kit/bunfig.toml",
      "/plugins/cc-smart-dev-kit/dist/cli.js",
    ]);
  });
});

describe("checkPrerequisites", () => {
  test("everything there: the profile folder is handed back", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    expect(checkPrerequisites(world.paths, world.deps)).toEqual({
      ok: true,
      profileDir: world.profileDir,
    });
  });

  test("each missing piece is named with the command that fixes it", () => {
    const noChrome = chromeWorld({ chrome: false });
    const chromeResult = checkPrerequisites(noChrome.paths, noChrome.deps);
    expect(chromeResult.ok).toBe(false);
    if (!chromeResult.ok) expect(chromeResult.why).toContain("browser setup");

    const noProfile = chromeWorld();
    const profileResult = checkPrerequisites(noProfile.paths, noProfile.deps);
    expect(profileResult.ok).toBe(false);
    if (!profileResult.ok) {
      expect(profileResult.why).toContain('the Chrome profile "claude-code" is not there');
      expect(profileResult.why).toContain("browser setup");
    }

    const noExtension = chromeWorld();
    noExtension.withProfile({ extension: false });
    const extensionResult = checkPrerequisites(noExtension.paths, noExtension.deps);
    expect(extensionResult.ok).toBe(false);
    if (!extensionResult.ok) {
      expect(extensionResult.why).toContain("Playwright extension is not installed");
    }

    const noToken = chromeWorld();
    noToken.withProfile({ fileUrls: true });
    const tokenResult = checkPrerequisites(noToken.paths, noToken.deps);
    expect(tokenResult.ok).toBe(false);
    if (!tokenResult.ok) expect(tokenResult.why).toContain("browser token");
  });
});

describe("fileUrlHint", () => {
  test("it names the profile and the exact switch a failure is fixed with", () => {
    expect(fileUrlHint()).toContain("claude-code");
    expect(fileUrlHint()).toContain("Allow access to file URLs");
    expect(fileUrlHint()).toContain("chrome://extensions/?id=");
  });
});

/** A fake CLI for the check's session: it ignores `browser mcp` and answers what this file says. */
function fakeCli(script: string): string[] {
  const file = join(tempDir("browser-check-child"), "child.js");
  writeFileSync(file, script);
  return [process.execPath, file];
}

/** Reports every check it is given, and keeps them. */
function checker() {
  const seen: { name: string; ok: boolean; why?: string | undefined }[] = [];
  return {
    check: (name: string, ok: boolean, why?: string) => seen.push({ name, ok, why }),
    seen,
  };
}

describe("the check always ends", () => {
  test("a child that never answers ends the check within the ready limit, and it stops there", async () => {
    // The launcher's own child never answers `initialize`: nothing else can work, so the run must
    // stop at once instead of waiting for every later call.
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const reported = checker();
    const began = Date.now();
    const result = await runBrowserCheck({
      check: reported.check,
      cli: fakeCli("process.stdin.resume();\n"),
      limitsMs: 1_200,
      log: () => undefined,
      machine: world.deps,
      paths: world.paths,
    });
    expect(Date.now() - began).toBeLessThan(4_000);
    expect(result).toEqual({ failed: 1, total: 1 });
    expect(reported.seen).toHaveLength(1);
    expect(reported.seen[0]?.ok).toBe(false);
    expect(reported.seen[0]?.why).toContain("no answer in");
  });

  test("a launcher that exits at once ends the check at once, with its own line", async () => {
    // The post-restart refusal: `browser mcp` prints one line and exits 2. The check must report
    // that line now, not after its 30 s answer limit.
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const reported = checker();
    const began = Date.now();
    const result = await runBrowserCheck({
      check: reported.check,
      cli: fakeCli(
        'process.stderr.write("the browser cannot connect. Open Google Chrome.\\n"); process.exit(2);\n',
      ),
      limitsMs: 4_000, // the answer limit here is 1 s
      log: () => undefined,
      machine: world.deps,
      paths: world.paths,
    });
    expect(Date.now() - began).toBeLessThan(900);
    expect(result).toEqual({ failed: 1, total: 1 });
    expect(reported.seen[0]?.why).toContain("exited before answering");
    expect(reported.seen[0]?.why).toContain("Open Google Chrome");
  });

  test("a child that answers initialize and not its tools ends at the whole check's limit", async () => {
    // Every call is answered by nothing: each has its own limit, and the whole run has the one
    // that ends it (before this, eight calls could each wait 90 s).
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const reported = checker();
    const began = Date.now();
    const result = await runBrowserCheck({
      check: reported.check,
      cli: fakeCli(`
        process.stdin.on("data", (chunk) => {
          for (const line of chunk.toString().split("\\n")) {
            if (line.trim() === "") continue;
            const message = JSON.parse(line);
            if (message.method !== "initialize") continue;
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { capabilities: {}, protocolVersion: "2025-06-18", serverInfo: { name: "fake", version: "1" } },
            }) + "\\n");
          }
        });
        process.stdin.resume();
      `),
      limitsMs: 1_200,
      log: () => undefined,
      machine: world.deps,
      paths: world.paths,
    });
    expect(Date.now() - began).toBeLessThan(6_000);
    expect(result.failed).toBeGreaterThan(0);
    const said = reported.seen.map((one) => one.why ?? "").join("\n");
    expect(said).toContain("ran out of its");
    expect(said).toContain("1.2 s limit");
  });
});
