import { describe, expect, test } from "bun:test";
import type { ClaudeMemCurrent } from "@/api/types";
import { fallbackWords, handSetWords, ownClaudeModelWords } from "./claude-mem-words";

type Fallback = ClaudeMemCurrent["fallback"];

function fallback(over: Partial<Fallback>): Fallback {
  return {
    claudeModel: null,
    idle: null,
    model: null,
    provider: "claude",
    refusedByHand: false,
    source: "default",
    target: null,
    ...over,
  };
}

describe("fallbackWords", () => {
  test("an empty fallback reads as Claude, with the model claude-mem really runs it on", () => {
    expect(fallbackWords(fallback({ claudeModel: "claude-haiku-5-5" }))).toBe(
      "Claude, on your own login: claude-mem's own model, claude-haiku-5-5",
    );
  });

  test("with no model set anywhere, it names claude-mem's built-in model, never a guessed one", () => {
    expect(fallbackWords(fallback({}))).toBe(
      "Claude, on your own login: claude-mem's own built-in model",
    );
  });

  test("a Claude model the person picked is named as theirs", () => {
    expect(
      fallbackWords(
        fallback({
          claudeModel: "claude-haiku-5-5",
          model: "claude-haiku-5-5",
          source: "portal",
        }),
      ),
    ).toBe("Claude, on your own login: claude-haiku-5-5");
  });

  test("off, and a backend model", () => {
    expect(fallbackWords(fallback({ provider: "off" }))).toBe(
      "Off: claude-mem waits for its route's provider",
    );
    expect(
      fallbackWords(fallback({ provider: "openrouter", target: "omniroute:glm-5.3-flash" })),
    ).toBe("glm-5.3-flash on omniroute");
    expect(fallbackWords(fallback({ provider: "gemini" }))).toBe("gemini");
  });
});

describe("ownClaudeModelWords", () => {
  test("names claude-mem's own model while the fallback uses it", () => {
    expect(ownClaudeModelWords(fallback({ claudeModel: "claude-haiku-5-5" }))).toBe(
      "claude-mem's own Claude model (claude-haiku-5-5)",
    );
  });

  test("names no model it cannot know: a picked model hides claude-mem's own", () => {
    expect(
      ownClaudeModelWords(
        fallback({ claudeModel: "claude-sonnet-5-5", model: "claude-sonnet-5-5" }),
      ),
    ).toBe("claude-mem's own Claude model");
    expect(ownClaudeModelWords(fallback({ provider: "off" }))).toBe(
      "claude-mem's own Claude model",
    );
  });
});

describe("handSetWords", () => {
  test("counts the values in words", () => {
    expect(handSetWords(1)).toBe("One value in claude-mem's file was set by hand");
    expect(handSetWords(5)).toBe("5 values in claude-mem's file were set by hand");
  });
});
