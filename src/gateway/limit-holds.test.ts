import { describe, expect, test } from "bun:test";
import { emptyConfig } from "./config";
import { claudeLimitHolds, targetsNow } from "./limit-holds";

const WORKER = "cc-smart-dev-kit-worker";
const KEY = `my-project/${WORKER}`;

describe("the chains in use now", () => {
  test("the machine's chain is its first target alone while its fallback switch is off", () => {
    const config = {
      ...emptyConfig(),
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
      slots: { [WORKER]: ["omniroute:glm-5.3-flash", "omniroute:glm-5.3-pro"] },
    };
    expect(targetsNow(config)).toEqual({ [WORKER]: ["omniroute:glm-5.3-flash"] });
  });

  test("the chains in use are read for every profile too, over the machine's", () => {
    const config = {
      ...emptyConfig(),
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
      // The profile's own fallback switch is on (off by default, D66), so its whole chain is in use.
      profiles: {
        "my-project": {
          fallback: { [WORKER]: true },
          slots: { [WORKER]: ["omniroute:glm-5.3-flash", "omniroute:glm-5.3-pro"] },
        },
        shared: {},
      },
      slots: { [WORKER]: ["omniroute:glm-5.3-flash"] },
    };
    expect(targetsNow(config)).toEqual({
      [WORKER]: ["omniroute:glm-5.3-flash"],
      [KEY]: ["omniroute:glm-5.3-flash", "omniroute:glm-5.3-pro"],
      [`shared/${WORKER}`]: ["omniroute:glm-5.3-flash"],
    });
  });
});

describe("a Claude limit holds a session only when Claude answers its slot first", () => {
  const SONNET = "claude-sonnet-5-5";

  test("a session on Claude itself (no slot key) is held", () => {
    expect(claudeLimitHolds(null, SONNET, { [WORKER]: ["omniroute:glm-5.3-flash"] })).toBe(true);
  });

  test("no readable config, or a key the config does not have: held", () => {
    expect(claudeLimitHolds(WORKER, SONNET, null)).toBe(true);
    expect(claudeLimitHolds(KEY, SONNET, { [WORKER]: ["omniroute:glm-5.3-flash"] })).toBe(true);
  });

  test("a chain that starts with that model, its context suffix aside: held", () => {
    expect(claudeLimitHolds(WORKER, SONNET, { [WORKER]: [SONNET, "omniroute:x"] })).toBe(true);
    expect(claudeLimitHolds(WORKER, SONNET, { [WORKER]: [`${SONNET}[1m]`] })).toBe(true);
  });

  test("a chain that starts with a backend, Claude only behind it: not held", () => {
    expect(
      claudeLimitHolds(WORKER, SONNET, { [WORKER]: ["omniroute:glm-5.3-flash", SONNET] }),
    ).toBe(false);
  });

  test("a chain that starts with another Claude model: not held by this one's limit", () => {
    expect(claudeLimitHolds(WORKER, SONNET, { [WORKER]: ["claude-opus-5-5"] })).toBe(false);
  });
});
