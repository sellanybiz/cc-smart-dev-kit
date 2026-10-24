/**
 * The one reader of "does the running router have feature X" (`routerFeature`, `healthHasFeature`),
 * built on the health answer's `features`. After the background self-update the CLI and the portal
 * are new while the running router may still be a 1.1.x copy, whose health answer has no
 * `features`. Every fetch here is a fake: nothing reaches a real port.
 */
import { describe, expect, test } from "bun:test";
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
