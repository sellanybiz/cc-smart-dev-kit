import { describe, expect, test } from "bun:test";

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("the preload's time zone", () => {
  test("TZ holds the zone the tests run in", () => {
    expect(process.env.TZ).toBeDefined();
    expect(process.env.TZ).toBe(zone());
  });

  test("a test that sets TZ and restores it leaves the zone as it found it", () => {
    const zoneBefore = zone();
    const before = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    expect(zone()).toBe("Pacific/Auckland");
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
    expect(zone()).toBe(zoneBefore);
  });
});
