/**
 * Profiles (owner D29): the `/p/<profile>` path a project's base URL carries, the config's
 * `profiles`, and the view of the config a profile's requests get. The router's side (the
 * strip before every branch, an unknown profile as plain Claude, a profile's own breaker and
 * fallback records) is tested in `gateway.test.ts`; this file is the contract it reads.
 *
 * Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import {
  emptyConfig,
  fallbackOn,
  JUDGE_NEVER_HOLDS,
  PROFILE_NAME_RULE,
  type ProfileConfig,
  parseConfig,
  plainClaudeView,
  profileNames,
  profileSlotChain,
  profileView,
} from "./config";
import { scopeOfStateKey, stateKeyFor } from "./limit-state";
import { isProfileName, PROFILE_PATH_PREFIX, profileFromPath } from "./targets";

const WORKER = "cc-smart-dev-kit-worker";
const OPUS = "cc-smart-dev-kit-opus";
const SCOUT = "cc-smart-dev-kit-scout";
const JUDGE = "cc-smart-dev-kit-judge";

/** A config as a machine has it: two slots with a chain, one backend, no profiles. */
function raw(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128/" } },
    port: 21111,
    slots: { [OPUS]: ["omniroute:default-opus"], [WORKER]: ["omniroute:default-worker"] },
    version: 1,
    ...extra,
  };
}

/** The config the text parses to, or the test fails with the error. */
function parsed(text: Record<string, unknown>) {
  const result = parseConfig(text);
  if ("error" in result) throw new Error(result.error);
  return result.config;
}

describe("the /p/<profile> path", () => {
  it("is one prefix in one home", () => {
    expect(PROFILE_PATH_PREFIX).toBe("/p/");
  });

  it("splits a path into the name and the path under it, kept as it came", () => {
    expect(profileFromPath("/p/proj/v1/messages")).toEqual({
      name: "proj",
      path: "/v1/messages",
    });
    expect(profileFromPath("/p/proj/v1/messages/count_tokens")).toEqual({
      name: "proj",
      path: "/v1/messages/count_tokens",
    });
    expect(profileFromPath("/p/proj/api/hello")).toEqual({ name: "proj", path: "/api/hello" });
    expect(profileFromPath("/p/proj/__cc-smart-dev-kit/health")).toEqual({
      name: "proj",
      path: "/__cc-smart-dev-kit/health",
    });
    // The name alone, and with its slash: the router's own root.
    expect(profileFromPath("/p/proj")).toEqual({ name: "proj", path: "/" });
    expect(profileFromPath("/p/proj/")).toEqual({ name: "proj", path: "/" });
    // The rest is kept as it came, a doubled slash included: it stays a path, never a host.
    expect(profileFromPath("/p/proj//elsewhere/x")).toEqual({
      name: "proj",
      path: "//elsewhere/x",
    });
  });

  it("has no name when there is no prefix, or nothing where a name goes", () => {
    expect(profileFromPath("/v1/messages")).toEqual({ name: null, path: "/v1/messages" });
    expect(profileFromPath("/")).toEqual({ name: null, path: "/" });
    expect(profileFromPath("/p/")).toEqual({ name: null, path: "/p/" });
    expect(profileFromPath("/p//v1/messages")).toEqual({ name: null, path: "/p//v1/messages" });
    expect(profileFromPath("/profiles/proj/v1/messages")).toEqual({
      name: null,
      path: "/profiles/proj/v1/messages",
    });
  });

  it("carries a segment the name pattern refuses, so the caller refuses it before any lookup", () => {
    // The router checks `isProfileName` before it reads the config: these never reach it.
    expect(profileFromPath("/p/Proj/v1/messages")).toEqual({ name: "Proj", path: "/v1/messages" });
    expect(profileFromPath("/p/a.b/v1/messages")).toEqual({ name: "a.b", path: "/v1/messages" });
    expect(isProfileName("Proj")).toBe(false);
    expect(isProfileName("a.b")).toBe(false);
  });

  it("a profile name is lower-case letters, digits and -, and at most 64", () => {
    for (const name of ["a", "proj", "proj-2", "my-project", "proj-", "0", "a".repeat(64)]) {
      expect(isProfileName(name)).toBe(true);
    }
    for (const name of ["", "Proj", "proj_2", "-proj", "proj/x", "a".repeat(65)]) {
      expect(isProfileName(name)).toBe(false);
    }
  });
});

describe("profiles in the config", () => {
  it("parses a profile's chains, claude, switches and kept chains", () => {
    const PROFILES: Record<string, ProfileConfig> = {
      proj: {
        breaker: { [WORKER]: false },
        fallback: { [WORKER]: false },
        kept: { [SCOUT]: { fallback: true, targets: ["omniroute:saved"] } },
        slots: { [OPUS]: "claude", [WORKER]: ["omniroute:proj-worker", "omniroute:proj-two"] },
      },
    };
    expect(parsed(raw({ profiles: PROFILES })).profiles).toEqual(PROFILES);
  });

  it("refuses a name a URL can never carry, in plain words", () => {
    const refused = parseConfig(raw({ profiles: { Proj: {} } }));
    expect(refused).toEqual({
      error: [`✖ ${PROFILE_NAME_RULE}`, "  → at profiles.Proj"].join("\n"),
    });
  });

  it("refuses a slot key that is not a slot, and a chain that is not a list", () => {
    expect(
      parseConfig(raw({ profiles: { proj: { slots: { worker: ["omniroute:m"] } } } })),
    ).toEqual({
      error: [
        '✖ "worker" is not a slot key (cc-smart-dev-kit-<name>)',
        "  → at profiles.proj.slots.worker",
      ].join("\n"),
    });
    const refused = parseConfig(raw({ profiles: { proj: { slots: { [WORKER]: "" } } } }));
    expect("error" in refused && refused.error).toContain(
      'a profile slot is "claude" (plain Claude for that slot there) or a chain: a list of one or more targets',
    );
  });

  it("refuses a target that is not one, and a backend the config does not hold", () => {
    const badTarget = parseConfig(
      raw({ profiles: { proj: { slots: { [WORKER]: ["not-a-target"] } } } }),
    );
    expect("error" in badTarget && badTarget.error).toContain(
      '"not-a-target" is neither claude-<id> nor <backend>:<model>',
    );
    const badBackend = parseConfig(
      raw({ profiles: { proj: { slots: { [WORKER]: ["other:model"] } } } }),
    );
    expect("error" in badBackend && badBackend.error).toContain(
      '"other:model" names backend "other", which is not in backends',
    );
  });

  it("refuses a fallback switch for a slot the profile has no chain for", () => {
    // Neither the profile's nor the machine's chains hold the scout.
    const refused = parseConfig(raw({ profiles: { proj: { fallback: { [SCOUT]: true } } } }));
    expect("error" in refused && refused.error).toContain(
      'fallback names slot "cc-smart-dev-kit-scout", which profile "proj" has no chain for',
    );
    // A slot the profile itself turns off is no chain either.
    const off = parseConfig(
      raw({ profiles: { proj: { fallback: { [OPUS]: true }, slots: { [OPUS]: "claude" } } } }),
    );
    expect("error" in off && off.error).toContain(
      'fallback names slot "cc-smart-dev-kit-opus", which profile "proj" has no chain for',
    );
  });

  it("the judge's switch needs no judge chain in a profile, as at the top level", () => {
    expect(parsed(raw({ profiles: { proj: { fallback: { [JUDGE]: false } } } })).profiles).toEqual({
      proj: { fallback: { [JUDGE]: false } },
    });
  });

  it("refuses a breaker for the judge, and for a slot the profile has no chain for", () => {
    const judge = parseConfig(raw({ profiles: { proj: { breaker: { [JUDGE]: true } } } }));
    expect("error" in judge && judge.error).toContain(
      `breaker names ${JUDGE}: ${JUDGE_NEVER_HOLDS}`,
    );
    const noChain = parseConfig(raw({ profiles: { proj: { breaker: { [SCOUT]: false } } } }));
    expect("error" in noChain && noChain.error).toContain(
      'breaker names slot "cc-smart-dev-kit-scout", which profile "proj" has no chain for',
    );
  });

  it("a machine without profiles parses and saves no profiles key", () => {
    const config = parsed(raw());
    expect(config.profiles).toBeUndefined();
    expect(profileNames(config)).toEqual([]);
  });

  it("an empty config has no profiles", () => {
    expect(profileNames(emptyConfig())).toEqual([]);
  });
});

describe("the view a profile's requests get", () => {
  const PROFILES: Record<string, ProfileConfig> = {
    proj: {
      breaker: { [WORKER]: false },
      fallback: { [WORKER]: false },
      slots: { [OPUS]: "claude", [WORKER]: ["omniroute:proj-worker"] },
    },
  };
  const config = parsed(raw({ profiles: PROFILES }));

  it("a slot the profile names takes its chain; one it does not keeps the machine's", () => {
    const view = profileView(config, "proj");
    expect(view?.slots).toEqual({ [WORKER]: ["omniroute:proj-worker"] });
  });

  it("keeps the machine's chain for a slot the profile does not name", () => {
    const two = parsed(raw({ profiles: { proj: { slots: { [WORKER]: ["omniroute:p"] } } } }));
    // The opus slot is the machine's: it is not in this profile's `slots`.
    expect(profileView(two, "proj")?.slots).toEqual({
      [OPUS]: ["omniroute:default-opus"],
      [WORKER]: ["omniroute:p"],
    });
  });

  it("a slot the machine chains and the profile does not name is the machine's", () => {
    const view = profileView(config, "proj");
    // Opus is `"claude"` in this profile: no chain there.
    expect(Object.hasOwn(view?.slots ?? {}, OPUS)).toBe(false);
    // The scout is in neither: off either way.
    expect(Object.hasOwn(view?.slots ?? {}, SCOUT)).toBe(false);
  });

  it("its switches win over the machine's, per slot, and the rest stay the machine's", () => {
    const view = profileView(config, "proj");
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(fallbackOn(view, WORKER)).toBe(false);
    expect(view.breaker).toEqual({ [WORKER]: false });
    // The machine's config is untouched: it still has both chains and no switches.
    expect(config.slots).toEqual({
      [OPUS]: ["omniroute:default-opus"],
      [WORKER]: ["omniroute:default-worker"],
    });
    expect(config.fallback).toBeUndefined();
    expect(config.breaker).toBeUndefined();
    // Machine-wide fields are the same objects and values.
    expect(view.backends).toBe(config.backends);
    expect(view.port).toBe(21111);
    expect(view.timeouts).toEqual(config.timeouts);
  });

  it("a slot the profile names but does not switch takes the machine's switch", () => {
    const switched = parsed(raw({ fallback: { [WORKER]: false }, profiles: { proj: {} } }));
    expect(fallbackOn(profileView(switched, "proj") ?? emptyConfig(), WORKER)).toBe(false);
  });

  it("an unknown name, and a name the pattern refuses, get no view", () => {
    expect(profileView(config, "nothing")).toBeNull();
    expect(profileView(config, "Proj")).toBeNull();
  });

  it("plain Claude is every slot off and no alias, with everything else kept", () => {
    const aliased = parsed(raw({ aliases: { "old-worker": "omniroute:default-worker" } }));
    const view = plainClaudeView(aliased);
    expect(view.slots).toEqual({});
    expect(view.aliases).toEqual({});
    expect(view.fallback).toBeUndefined();
    expect(view.breaker).toBeUndefined();
    expect(view.backends).toBe(aliased.backends);
    expect(view.port).toBe(21111);
    // The config itself is untouched.
    expect(Object.keys(aliased.slots)).toHaveLength(2);
    expect(aliased.aliases).toEqual({ "old-worker": "omniroute:default-worker" });
  });

  it("profileSlotChain says the profile's chain, null for claude, the machine's otherwise", () => {
    const profile = config.profiles?.proj ?? {};
    expect(profileSlotChain(config, profile, WORKER)).toEqual(["omniroute:proj-worker"]);
    expect(profileSlotChain(config, profile, OPUS)).toBeNull();
    expect(profileSlotChain(config, profile, SCOUT)).toBeNull();
    const kept = parsed(raw({ profiles: { proj: {} } }));
    expect(profileSlotChain(kept, kept.profiles?.proj ?? {}, OPUS)).toEqual([
      "omniroute:default-opus",
    ]);
  });
});

describe("the limit state's key per profile", () => {
  it("the machine's default is the slot alone; a profile's is <profile>/<slot>", () => {
    expect(stateKeyFor(WORKER, null)).toBe("cc-smart-dev-kit-worker");
    expect(stateKeyFor(WORKER, "proj")).toBe("proj/cc-smart-dev-kit-worker");
  });

  it("reads back to the profile and the slot", () => {
    expect(scopeOfStateKey("cc-smart-dev-kit-worker")).toEqual({
      profile: null,
      slot: "cc-smart-dev-kit-worker",
    });
    expect(scopeOfStateKey("proj/cc-smart-dev-kit-worker")).toEqual({
      profile: "proj",
      slot: "cc-smart-dev-kit-worker",
    });
    // A profile name never holds a `/`, so the first one is the separator.
    expect(scopeOfStateKey(stateKeyFor(JUDGE, "a-b-2"))).toEqual({
      profile: "a-b-2",
      slot: JUDGE,
    });
  });
});
