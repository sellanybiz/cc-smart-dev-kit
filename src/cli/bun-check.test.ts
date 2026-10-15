import { describe, expect, test } from "bun:test";
import { oldBunRefusal } from "./bun-check";

const OLD = "1.4.2";
const BUN = "/opt/bun/bin/bun";

describe("oldBunRefusal", () => {
  test.each(["setup", "gateway", "search", "unknown-command"])(
    "on an older Bun, %p stops with the reason and the next step",
    (command) => {
      expect(oldBunRefusal(command, OLD, BUN)).toBe(
        "anymodel: anymodel needs Bun ≥ 1.4.3; this is 1.4.2 (/opt/bun/bin/bun). Upgrade this Bun, then run the command again.",
      );
    },
  );

  test.each([undefined, "doctor", "restore", "version", "--version", "help", "--help", "-h"])(
    "on an older Bun, %p still runs: it sends no key, and it helps",
    (command) => {
      expect(oldBunRefusal(command, OLD, BUN)).toBeNull();
    },
  );

  test.each(["setup", "gateway", "search"])("on Bun 1.4.3, %p runs", (command) => {
    expect(oldBunRefusal(command, "1.4.3", BUN)).toBeNull();
  });
});
