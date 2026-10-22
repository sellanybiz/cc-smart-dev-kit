import { describe, expect, test } from "bun:test";
import { readSecretLine } from "../secret-line";
import { createPrompts, type PromptIO, terminalPrompts } from "./prompt";
import { detectTerminal, type Terminal } from "./terminal";

const PLAIN: Terminal = detectTerminal({ env: {}, isTTY: false, platform: "linux" });
const RICH: Terminal = detectTerminal({ columns: 40, env: {}, isTTY: true, platform: "linux" });
const OLD_WINDOWS: Terminal = detectTerminal({ env: {}, isTTY: true, platform: "win32" });

/**
 * A scripted terminal: each typed line in turn (null: Enter, or the end of the input), and all
 * the text it was shown, in one string, the way a person's screen reads it.
 */
function terminal(answers: (string | null)[], extra: Partial<PromptIO> = {}) {
  let screen = "";
  const io: PromptIO = {
    write: (text) => {
      screen += text;
    },
    readLine: (shown) => {
      const typed = answers.shift() ?? null;
      // The terminal echoes what is typed, then Enter moves to the next line.
      screen += `${shown} ${typed ?? ""}\n`;
      return typed;
    },
    ...extra,
  };
  return { io, screen: () => screen };
}

describe("confirm", () => {
  test("the default is shown, and Enter takes it: no unless the question says yes", () => {
    const no = terminal([null]);
    expect(createPrompts(PLAIN, no.io).confirm("Write these files?")).toBe(false);
    expect(no.screen()).toBe("Write these files? [y/N] \n");
    const yes = terminal([null]);
    expect(createPrompts(PLAIN, yes.io).confirm("Name each session?", true)).toBe(true);
    expect(yes.screen()).toBe("Name each session? [Y/n] \n");
    // Spaces before Enter are Enter too, never "not understood".
    const spaces = terminal(["   "]);
    expect(createPrompts(PLAIN, spaces.io).confirm("Go?", true)).toBe(true);
    expect(spaces.screen()).toBe("Go? [Y/n]    \n");
  });

  test("y, yes, n and no in any case, with spaces around", () => {
    for (const [typed, answer] of [
      ["y", true],
      [" YES ", true],
      ["n", false],
      ["No", false],
    ] as const) {
      expect(createPrompts(PLAIN, terminal([typed]).io).confirm("Go?", !answer)).toBe(answer);
    }
  });

  test("an answer that is not understood is asked again once, with what to type", () => {
    const t = terminal(["sure", "y"]);
    expect(createPrompts(PLAIN, t.io).confirm("Go?")).toBe(true);
    expect(t.screen()).toBe(
      "Go? [y/N] sure\n! Not understood: answer y or n (Enter keeps no).\nGo? [y/N] y\n",
    );
  });

  test("twice not understood: the default, said in words, and no third question", () => {
    const t = terminal(["sure", "maybe", "y"]);
    expect(createPrompts(PLAIN, t.io).confirm("Go?", true)).toBe(true);
    expect(t.screen()).toBe(
      "Go? [Y/n] sure\n! Not understood: answer y or n (Enter keeps yes).\nGo? [Y/n] maybe\n! Not understood again: yes, the default.\n",
    );
  });

  test("the end of the input takes the default at once: a run never hangs on a question", () => {
    // Ctrl+D, or a terminal that went away: every read answers null from then on.
    const t = terminal([]);
    const prompts = createPrompts(PLAIN, t.io);
    expect(prompts.confirm("Go?")).toBe(false);
    expect(prompts.confirm("Again?", true)).toBe(true);
    expect(t.screen()).toBe("Go? [y/N] \nAgain? [Y/n] \n");
  });
});

describe("ask", () => {
  test("the default in brackets, and Enter takes it; an empty default shows no brackets", () => {
    const t = terminal([null, null]);
    const prompts = createPrompts(PLAIN, t.io);
    expect(prompts.ask("Base branch", { default: "main" })).toBe("main");
    expect(prompts.ask("Workflow policy", { default: "" })).toBe("");
    expect(t.screen()).toBe("Base branch [main] \nWorkflow policy \n");
  });

  test("an answer is trimmed; one the check refuses is asked again once, with the reason", () => {
    const check = (answer: string) => (answer.includes("=") ? null : "pairs are prefix=base");
    const t = terminal(["release", "  release/=dev  "]);
    expect(createPrompts(PLAIN, t.io).ask("Bases", { default: "hotfix/=main", check })).toBe(
      "release/=dev",
    );
    expect(t.screen()).toBe(
      "Bases [hotfix/=main] release\n! Not understood: pairs are prefix=base.\nBases [hotfix/=main]   release/=dev  \n",
    );
  });

  test("twice refused: the default, said in words; the default itself is never checked", () => {
    const refuse = () => "never";
    const t = terminal(["a", "b"]);
    expect(createPrompts(PLAIN, t.io).ask("Bases", { default: "x", check: refuse })).toBe("x");
    expect(t.screen()).toContain("! Not understood again (never): x, the default.\n");
    expect(
      createPrompts(PLAIN, terminal([null]).io).ask("Bases", { default: "x", check: refuse }),
    ).toBe("x");
  });
});

describe("drawn like the rest of the output", () => {
  test("rich: a long question wraps to the width, and the hint is dim", () => {
    const t = terminal([null]);
    createPrompts(RICH, t.io).confirm("Send heavy commands through the machine's job queue?");
    expect(t.screen()).toBe(
      "Send heavy commands through the\nmachine's job queue? \x1b[2m[y/N]\x1b[0m \n",
    );
  });

  test("an old Windows console: ASCII words, the marks of the module", () => {
    const t = terminal(["?", null]);
    createPrompts(OLD_WINDOWS, t.io).confirm("Run it — now?");
    expect(t.screen()).toBe(
      "Run it - now? [y/N] ?\n[!] Not understood: answer y or n (Enter keeps no).\nRun it - now? [y/N] \n",
    );
  });
});

describe("the secret read", () => {
  /** A terminal in raw mode that answers with `keys`, as `readSecretLine` reads it. */
  function rawTerminal(keys: string) {
    const modes: boolean[] = [];
    let listener: ((chunk: Buffer) => void) | undefined;
    return {
      modes,
      raw: {
        isTTY: true,
        off: () => {
          listener = undefined;
        },
        on: (_event: "data", next: (chunk: Buffer) => void) => {
          listener = next;
          queueMicrotask(() => listener?.(Buffer.from(keys, "utf8")));
        },
        setRawMode: (on: boolean) => {
          modes.push(on);
        },
      },
    };
  }

  test("the question is shown, the secret is read with no echo, and it is never on the screen", async () => {
    const tty = rawTerminal("s3cret-pass\r");
    const t = terminal([], { readSecret: () => readSecretLine(tty.raw) });
    const secret = createPrompts(PLAIN, t.io).secret;
    expect(await secret?.("OmniRoute's dashboard password")).toBe("s3cret-pass");
    expect(t.screen()).toBe("OmniRoute's dashboard password (it is not shown) \n");
    expect(t.screen()).not.toContain("s3cret");
    // Raw mode on for the read, off after it: the terminal's echo is back.
    expect(tty.modes).toEqual([true, false]);
  });

  test("Ctrl+C answers null, and gives the terminal back", async () => {
    const tty = rawTerminal("half\u0003");
    const t = terminal([], { readSecret: () => readSecretLine(tty.raw) });
    expect(await createPrompts(PLAIN, t.io).secret?.("Token")).toBeNull();
    expect(tty.modes).toEqual([true, false]);
    expect(t.screen()).not.toContain("half");
  });

  test("a terminal that cannot hide what is typed has no secret read: the caller names the stdin flag", () => {
    expect(createPrompts(PLAIN, terminal([]).io).secret).toBeNull();
  });
});

describe("no terminal, no questions", () => {
  test("stdin that is not a terminal: no prompts at all (a pipe, a script, CI)", () => {
    const pipe = { isTTY: false, off: () => undefined, on: () => undefined };
    expect(terminalPrompts(PLAIN, pipe)).toBeNull();
    const unknown = { off: () => undefined, on: () => undefined };
    expect(terminalPrompts(PLAIN, unknown)).toBeNull();
  });

  test("a terminal: prompts, and the secret read only where the echo can be switched off", () => {
    const noRaw = { isTTY: true, off: () => undefined, on: () => undefined };
    expect(terminalPrompts(PLAIN, noRaw)?.secret).toBeNull();
    const raw = { ...noRaw, setRawMode: () => undefined };
    expect(terminalPrompts(PLAIN, raw)?.secret).toBeFunction();
  });
});
