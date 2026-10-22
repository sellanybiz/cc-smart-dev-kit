/**
 * How a worker's facts are shown (`display.ts`): the model, how long ago, the memory, the last
 * line of a program's output.
 */
import { describe, expect, test } from "bun:test";
import { agoText, lastLine, memoryText, modelText } from "./display";

const NOW = Date.parse("2026-10-21T10:00:00.000Z");

describe("modelText", () => {
  test("the name alone while nothing else answers it; `named -> resolved` when something does", () => {
    expect(modelText("sonnet", "sonnet")).toBe("sonnet");
    expect(modelText("sonnet", "omniroute:glm-5.1")).toBe("sonnet → omniroute:glm-5.1");
  });
});

describe("agoText", () => {
  test("minutes, hours and days, rounded down; under a minute is just now", () => {
    expect(agoText("2026-10-21T10:00:00.000Z", NOW)).toBe("just now");
    expect(agoText("2026-10-21T09:59:30.000Z", NOW)).toBe("just now");
    expect(agoText("2026-10-21T09:59:00.000Z", NOW)).toBe("1 min ago");
    expect(agoText("2026-10-21T09:48:00.000Z", NOW)).toBe("12 min ago");
    expect(agoText("2026-10-21T09:00:00.000Z", NOW)).toBe("1 h ago");
    expect(agoText("2026-10-21T07:00:00.000Z", NOW)).toBe("3 h ago");
    expect(agoText("2026-10-19T10:00:00.000Z", NOW)).toBe("2 d ago");
  });

  test("a moment in the future reads as just now; a time that is no time is shown as written", () => {
    expect(agoText("2026-10-21T10:05:00.000Z", NOW)).toBe("just now");
    expect(agoText("someday", NOW)).toBe("someday");
  });
});

describe("memoryText", () => {
  test("megabytes, or a dash while nobody has read them", () => {
    expect(memoryText(512)).toBe("512 MB");
    expect(memoryText(0)).toBe("0 MB");
    expect(memoryText(null)).toBe("-");
  });
});

describe("lastLine", () => {
  test("the last line that says something, trimmed; nothing for nothing", () => {
    expect(lastLine("one\ntwo\n")).toBe("two");
    expect(lastLine("one\r\n  two  \r\n\r\n")).toBe("two");
    expect(lastLine("   \n")).toBe("");
    expect(lastLine("")).toBe("");
  });
});
