/**
 * The one reader of "does the running router have feature X" (`routerFeature`, `healthHasFeature`),
 * built on the health answer's `features`. After the background self-update the CLI and the portal
 * are new while the running router may still be a 1.1.x copy, whose health answer has no
 * `features`. Every fetch here is a fake: nothing reaches a real port.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { type HealthFetch, healthHasFeature, routerFeature } from "./health";
import { ROUTER_FEATURES } from "./router";

/** A port no router uses: only the fake fetch ever sees it. */
const PORT = 45_987;

/** A fake fetch that answers every request with `answer`, and the URLs it was asked. */
function answering(answer: () => Response): { fetch: HealthFetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: HealthFetch = async (url) => {
    urls.push(url);
    return answer();
  };
  return { fetch, urls };
}

/** A 1.1.x router's health answer: everything but `features`. */
const OLD_ANSWER = { cooling: {}, fallbacks: 0, ok: true, port: PORT, requests: 3, uptimeSec: 9 };

describe("the router's features", () => {
  test("this router lists profiles: the commands that write a profile's URL rely on it", () => {
    expect(ROUTER_FEATURES).toContain("profiles");
  });

  test("a 1.1.x router's answer has no features: it has none of them", async () => {
    const old = answering(() => Response.json(OLD_ANSWER));
    expect(await routerFeature(PORT, "profiles", old.fetch)).toEqual({ has: false });
    expect(old.urls).toEqual([`http://127.0.0.1:${PORT}/__cc-smart-dev-kit/health`]);
  });

  test("a router that lists profiles has it", async () => {
    const current = answering(() => Response.json({ ...OLD_ANSWER, features: ["profiles"] }));
    expect(await routerFeature(PORT, "profiles", current.fetch)).toEqual({ has: true });
  });

  test("a router that lists other features only does not have it", async () => {
    const other = answering(() => Response.json({ ...OLD_ANSWER, features: ["something-else"] }));
    expect(await routerFeature(PORT, "profiles", other.fetch)).toEqual({ has: false });
  });

  test("no answer is said in words, never guessed either way", async () => {
    const down: HealthFetch = async () => {
      throw new TypeError("Unable to connect");
    };
    expect(await routerFeature(PORT, "profiles", down)).toEqual({ error: "Unable to connect" });
    const failing = answering(() => new Response("busy", { status: 503 }));
    expect(await routerFeature(PORT, "profiles", failing.fetch)).toEqual({ error: "HTTP 503" });
  });

  test("an answer of another shape lists nothing", () => {
    expect(healthHasFeature(null, "profiles")).toBe(false);
    expect(healthHasFeature("profiles", "profiles")).toBe(false);
    expect(healthHasFeature(["profiles"], "profiles")).toBe(false);
    expect(healthHasFeature({ features: "profiles" }, "profiles")).toBe(false);
    expect(healthHasFeature({ features: [1, null, "profiles"] }, "profiles")).toBe(true);
  });
});

/**
 * Runs `lines` as a bun script of its own with `HTTP_PROXY` pointed at nothing (Bun reads the
 * proxy at its start, so an in-process change would prove nothing), given the fake service's
 * port as its first argument. Returns what the script printed.
 */
async function runUnderProxy(lines: string[], port: number): Promise<string> {
  const runner = join(tempDir("health-proxy"), "runner.ts");
  writeFileSync(runner, lines.join("\n"));
  const guard = subprocessGuard();
  const { NO_PROXY: _upper, no_proxy: _lower, ...inherited } = process.env;
  const proc = Bun.spawn([process.execPath, ...guard.args, runner, String(port)], {
    env: {
      ...inherited,
      ...guard.env,
      HTTP_PROXY: "http://127.0.0.1:9",
      http_proxy: "http://127.0.0.1:9",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  expect(err).toBe("");
  return out;
}

describe("every probe of a service on this machine reaches it straight (RV3, FX1)", () => {
  test("a proxy in the environment does not make a running router look silent", async () => {
    // Bun sends a loopback request to HTTP_PROXY unless NO_PROXY names the host
    // (`src/gateway/hosts.ts`). The proxy address here has nothing behind it, so any request
    // that goes there fails.
    const router = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ...OLD_ANSWER, features: ["profiles"] }),
    });
    try {
      const out = await runUnderProxy(
        [
          `import { realProbe, routerFeature, routerHealth } from ${JSON.stringify(join(import.meta.dir, "health"))};`,
          "const port = Number(process.argv[2]);",
          "const health = await routerHealth(port);",
          "const probe = await realProbe().fetch('http://127.0.0.1:' + port + '/x', {});",
          "const feature = await routerFeature(port, 'profiles');",
          "console.log(JSON.stringify({ feature, health: 'body' in health, probe: probe.status }));",
        ],
        Number(router.port),
      );
      expect(JSON.parse(out)).toEqual({ feature: { has: true }, health: true, probe: 200 });
    } finally {
      router.stop(true);
    }
  });

  test("the portal's probe, OmniRoute's health fetch and the portal starter's probe too", async () => {
    // A running portal looked down under HTTP_PROXY with no NO_PROXY, and so did OmniRoute.
    const service = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    });
    try {
      const out = await runUnderProxy(
        [
          `import { loopbackFetch } from ${JSON.stringify(join(import.meta.dir, "health"))};`,
          `import { realPortalProbe } from ${JSON.stringify(join(import.meta.dir, "..", "portal", "health"))};`,
          "const url = 'http://127.0.0.1:' + Number(process.argv[2]) + '/x';",
          "const portal = await realPortalProbe().fetch(url, {});",
          "const loopback = await loopbackFetch(url, {});",
          "console.log(JSON.stringify({ loopback: loopback.status, portal: portal.status }));",
        ],
        Number(service.port),
      );
      expect(JSON.parse(out)).toEqual({ loopback: 200, portal: 200 });
    } finally {
      service.stop(true);
    }
  });

  test("the OmniRoute health fetch of the CLI and of doctor, and the portal starter's probe, are the loopback helper", () => {
    // Their `fetch` is built inside an entry or a long function, so the proof is the source: each
    // names the helper, and none keeps a bare `fetch(url, init)` on a `health` or `probe` line.
    const root = join(import.meta.dir, "..");
    const named: [string, RegExp][] = [
      ["entries/cli.ts", /^\s*health: loopbackFetch,$/m],
      ["cli/doctor.ts", /^\s*health: loopbackFetch,$/m],
      ["entries/portal.ts", /^\s*fetch: loopbackFetch,$/m],
      ["entries/portal.ts", /^\s*probe: realPortalProbe\(\),$/m],
    ];
    for (const [file, pattern] of named) {
      expect(readFileSync(join(root, file), "utf8")).toMatch(pattern);
    }
    for (const file of ["entries/cli.ts", "cli/doctor.ts", "entries/portal.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toMatch(/\b(health|probe)\b[^\n]*=> fetch\(url, init\)/);
      expect(source).not.toMatch(/^\s*fetch: \(url, init\) => fetch\(url, init\),$/m);
    }
  });
});
