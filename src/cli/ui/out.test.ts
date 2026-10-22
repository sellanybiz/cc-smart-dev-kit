import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  asciiText,
  createOut,
  dryRunEnding,
  leadingMark,
  markText,
  renderGroup,
  renderLine,
  renderVerdict,
  textSink,
  wrapWords,
} from "./out";
import { DEFAULT_WIDTH, detectTerminal, MAX_WIDTH, type Terminal } from "./terminal";

const PLAIN: Terminal = detectTerminal({ env: {}, isTTY: false, platform: "linux" });
const RICH: Terminal = detectTerminal({ columns: 40, env: {}, isTTY: true, platform: "linux" });
const OLD_WINDOWS: Terminal = detectTerminal({ env: {}, isTTY: true, platform: "win32" });

/** An `Out` whose text is collected. */
function collect(term: Terminal) {
  let text = "";
  return {
    out: createOut(
      term,
      textSink((part) => {
        text += part;
      }),
    ),
    text: () => text,
  };
}

describe("terminal", () => {
  test("a pipe is plain: no colour, no wrap, Unicode marks", () => {
    expect(PLAIN).toEqual({
      color: false,
      rich: false,
      unicode: true,
      width: Number.POSITIVE_INFINITY,
    });
  });

  test("a TTY is rich, coloured, and wraps to its own width", () => {
    expect(RICH).toEqual({ color: true, rich: true, unicode: true, width: 40 });
  });

  test("a wide terminal wraps at the most, one that says nothing at the default", () => {
    const wide = detectTerminal({ columns: 300, env: {}, isTTY: true, platform: "linux" });
    expect(wide.width).toBe(MAX_WIDTH);
    const silent = detectTerminal({ env: {}, isTTY: true, platform: "darwin" });
    expect(silent.width).toBe(DEFAULT_WIDTH);
  });

  test("NO_COLOR with a value takes the colour away and keeps the rest", () => {
    const term = detectTerminal({
      columns: 60,
      env: { NO_COLOR: "1" },
      isTTY: true,
      platform: "linux",
    });
    expect(term).toEqual({ color: false, rich: true, unicode: true, width: 60 });
    // no-color.org: an empty value is not set.
    const empty = detectTerminal({ env: { NO_COLOR: "" }, isTTY: true, platform: "linux" });
    expect(empty.color).toBe(true);
  });

  test("TERM=dumb is plain, even on a TTY", () => {
    const term = detectTerminal({
      columns: 60,
      env: { TERM: "dumb" },
      isTTY: true,
      platform: "linux",
    });
    expect(term.rich).toBe(false);
    expect(term.color).toBe(false);
    expect(term.width).toBe(Number.POSITIVE_INFINITY);
  });

  test("an old Windows console gets ASCII and no colour; Windows Terminal and VS Code do not", () => {
    expect(OLD_WINDOWS).toMatchObject({ color: false, rich: true, unicode: false });
    // Piped, Windows keeps Unicode: a program reads those bytes as UTF-8.
    expect(detectTerminal({ env: {}, isTTY: false, platform: "win32" }).unicode).toBe(true);
    for (const env of [{ WT_SESSION: "abc" }, { TERM_PROGRAM: "vscode" }]) {
      expect(detectTerminal({ env, isTTY: true, platform: "win32" })).toMatchObject({
        color: true,
        unicode: true,
      });
    }
  });
});

describe("wrapWords", () => {
  test("wraps at the width, and never cuts a word longer than the line", () => {
    expect(wrapWords("one two three four", 9, 9)).toEqual(["one two", "three", "four"]);
    expect(wrapWords("a /a/very/long/path/that/does/not/fit b", 10, 10)).toEqual([
      "a",
      "/a/very/long/path/that/does/not/fit",
      "b",
    ]);
  });

  test("a newline starts a new line; plain output is never wrapped", () => {
    expect(wrapWords("one\ntwo three", 100, 100)).toEqual(["one", "two three"]);
    const long = "word ".repeat(60).trim();
    expect(wrapWords(long, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toEqual([long]);
  });

  test("counts columns as the terminal draws them", () => {
    // Each of these is two columns wide.
    expect(wrapWords("日本 語語", 4, 4)).toEqual(["日本", "語語"]);
  });
});

describe("renderLine", () => {
  test("plain: the mark, the text, and the fix under it, exactly", () => {
    expect(renderLine(PLAIN, "fail", "the launcher is out of date", { fix: "x setup" })).toEqual([
      "✗ the launcher is out of date",
      "  Fix: x setup",
    ]);
    expect(renderLine(PLAIN, "ok", "Bun 1.4.3", { indent: 2 })).toEqual(["  ✓ Bun 1.4.3"]);
  });

  test("rich: the same words, the mark coloured, wrapped with a hanging indent", () => {
    const lines = renderLine(RICH, "fail", "the launcher at ~/.local/bin/tool is out of date now", {
      fix: "run the setup command again, then check",
      indent: 2,
    });
    expect(lines).toEqual([
      "  \x1b[31m✗\x1b[0m the launcher at ~/.local/bin/tool is",
      "    out of date now",
      "    Fix: run the setup command again,",
      "         then check",
    ]);
    // Every line fits the width once the colour codes are left out.
    for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
    // The same words as plain.
    const words = (text: string[]) =>
      text
        .join(" ")
        .replaceAll("\x1b[31m", "")
        .replaceAll("\x1b[0m", "")
        .split(/\s+/)
        .filter(Boolean);
    expect(words(lines)).toEqual(
      words(
        renderLine(PLAIN, "fail", "the launcher at ~/.local/bin/tool is out of date now", {
          fix: "run the setup command again, then check",
          indent: 2,
        }),
      ),
    );
  });

  test("an old Windows console: ASCII marks and ASCII words", () => {
    expect(renderLine(OLD_WINDOWS, "ok", "Bun ≥ 1.4 — fine → next…")).toEqual([
      "[ok] Bun >= 1.4 - fine -> next...",
    ]);
    expect(markText(OLD_WINDOWS, "fail")).toBe("[x]");
    expect(markText(OLD_WINDOWS, "info")).toBe("[i]");
    expect(markText(OLD_WINDOWS, "warn")).toBe("[!]");
    expect(asciiText("“a” ‘b’ ✓ ✗ · •")).toBe("\"a\" 'b' [ok] [x] - *");
  });
});

describe("groups and the verdict", () => {
  test("a group line pads its title so the summaries line up", () => {
    expect(
      renderGroup(PLAIN, { mark: "ok", summary: "8 passed", title: "Updates", titleWidth: 12 }, [
        { mark: "info", text: "no check yet" },
      ]),
    ).toEqual(["✓ Updates       8 passed", "  · no check yet"]);
  });

  test("the verdict is the whole line in its colour on a colour terminal", () => {
    expect(renderVerdict(PLAIN, "fail", "2 to fix")).toEqual(["✗ 2 to fix"]);
    expect(renderVerdict(RICH, "ok", "Everything works")).toEqual([
      "\x1b[32m✓ Everything works\x1b[0m",
    ]);
  });
});

describe("Out", () => {
  test("prints each part on its own line, plain", () => {
    const { out, text } = collect(PLAIN);
    out.heading("tool 1.0: checking");
    out.blank();
    out.line("warn", "a warning", { fix: "do this" });
    out.next(["restart Claude Code", "run tool doctor"]);
    out.json({ ok: true });
    expect(text()).toBe(
      "tool 1.0: checking\n\n! a warning\n  Fix: do this\nNext steps:\n  1. restart Claude Code\n  2. run tool doctor\n" +
        '{\n  "ok": true\n}\n',
    );
  });

  test("marked lines: plain keeps every word and mark as written; rich colours the mark", () => {
    const lines = [
      "+ ~/.local/bin/tool: created",
      "~ ~/.claude/settings.json: statusLine",
      "- ~/old: removed",
      "  ~/.tmux.conf: left as you set it",
      "! a note",
      "Nothing to change.",
    ];
    const plain = collect(PLAIN);
    plain.out.marked(lines);
    expect(plain.text()).toBe(`${lines.join("\n")}\n`);
    const rich = collect(RICH);
    rich.out.marked(["+ made", "! careful"]);
    expect(rich.text()).toBe("\x1b[32m+\x1b[0m made\n\x1b[33m!\x1b[0m careful\n");
    const old = collect(OLD_WINDOWS);
    old.out.marked(["! careful — now"]);
    expect(old.text()).toBe("[!] careful - now\n");
  });

  test("a line with a newline in it, or no mark, is printed as it is", () => {
    expect(leadingMark("+ two\nlines")).toBeNull();
    expect(leadingMark("Nothing to change.")).toBeNull();
    expect(leadingMark("- gone")).toEqual({ mark: "removed", text: "gone" });
    // A command run or to run, and information, as the shared line makers write them.
    expect(leadingMark("$ claude mcp add")).toEqual({ mark: "run", text: "claude mcp add" });
    expect(leadingMark("· not registered")).toEqual({ mark: "info", text: "not registered" });
  });

  test("a line with the commands it names under it, never wrapped; a run mark", () => {
    expect(
      renderLine(RICH, "fail", "claude is not on PATH, so these were skipped:", {
        detail: ["$ claude plugin marketplace add example-org/a-very-long-marketplace-name"],
      }),
    ).toEqual([
      "\x1b[31m✗\x1b[0m claude is not on PATH, so these were",
      "  skipped:",
      "  $ claude plugin marketplace add example-org/a-very-long-marketplace-name",
    ]);
    expect(renderLine(PLAIN, "run", "claude mcp list")).toEqual(["$ claude mcp list"]);
    expect(renderLine(RICH, "run", "x")).toEqual(["\x1b[36m$\x1b[0m x"]);
  });

  test("a next step with its command: the command on its own line, whole", () => {
    const { out, text } = collect(RICH);
    out.next([
      {
        text: "Add the folder to your PATH, then open a new terminal:",
        command: 'export PATH="$HOME/.local/bin:$PATH"',
      },
      "Start a new session.",
    ]);
    expect(text()).toBe(
      [
        "Next steps:",
        "  1. Add the folder to your PATH, then",
        "     open a new terminal:",
        '       export PATH="$HOME/.local/bin:$PATH"',
        "  2. Start a new session.",
        "",
      ].join("\n"),
    );
  });

  test("one dry-run ending for every command", () => {
    expect(dryRunEnding(["written"])).toBe("Dry run: nothing was written.");
    expect(dryRunEnding(["written", "run"])).toBe("Dry run: nothing was written or run.");
    expect(dryRunEnding(["written", "run", "stopped"])).toBe(
      "Dry run: nothing was written, run or stopped.",
    );
  });

  test("the heading is bold only with colour", () => {
    const { out, text } = collect(RICH);
    out.heading("Title");
    expect(text()).toBe("\x1b[1mTitle\x1b[0m\n");
  });

  test("progress: nothing at all in plain output, and the work's answer", async () => {
    const { out, text } = collect(PLAIN);
    expect(await out.progress("Checking…", async () => 7)).toBe(7);
    expect(text()).toBe("");
  });

  test("progress on a terminal: the label while it runs, a clear line after, also on a throw", async () => {
    const { out, text } = collect(RICH);
    expect(await out.progress("Gateway…", async () => "done")).toBe("done");
    expect(text()).toBe("\r\x1b[2K⠋ Gateway…\r\x1b[2K");
    const failing = collect(OLD_WINDOWS);
    await expect(
      failing.out.progress("Gateway…", async () => {
        throw new Error("broke");
      }),
    ).rejects.toThrow("broke");
    expect(failing.text()).toBe("\r\x1b[2K| Gateway...\r\x1b[2K");
  });
});

/**
 * The relative imports a file makes, resolved to files: `Bun.Transpiler` reads them from the
 * real code (a type-only import is dropped, the way the bundle drops it).
 */
function importsOf(file: string, transpiler: Bun.Transpiler): string[] {
  // A macro import (`src/build-info/`) runs at build time; read here, it is a plain import.
  const source = readFileSync(file, "utf8").replace(/\bwith\s*\{\s*type:\s*"macro"\s*\}/g, "");
  return transpiler
    .scanImports(source)
    .map((entry) => entry.path)
    .filter((path) => path.startsWith("."))
    .map((path) => {
      const base = resolve(dirname(file), path);
      const found = [base, `${base}.ts`, join(base, "index.ts")].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      );
      if (found === undefined) throw new Error(`${file} imports ${path}, which is not a file`);
      return found;
    });
}

/** Every file `entry` reaches through its imports. */
function reachable(entry: string): Set<string> {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file, transpiler));
  }
  return seen;
}

describe("who never imports it", () => {
  const src = join(import.meta.dir, "..", "..");
  const ui = join(src, "cli", "ui");
  const entries = join(src, "entries");
  // Every bundle whose stdout a program reads: the router, and each hook (Claude Code reads a
  // hook's stdout). The CLI and the portal print to a person.
  const programs = readdirSync(entries)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .filter((name) => name !== "cli.ts" && name !== "portal.ts")
    .map((name) => join(entries, name));

  test("there are bundles to check, the router among them", () => {
    expect(programs).toContain(join(entries, "router.ts"));
    expect(programs.length).toBeGreaterThan(5);
  });

  test("the router bundle and every hook bundle reach no file of the output module", () => {
    for (const entry of programs) {
      const touched = [...reachable(entry)].filter((file) => file.startsWith(`${ui}/`));
      expect({ entry, touched }).toEqual({ entry, touched: [] });
    }
  });

  test("`browser mcp`'s launcher reaches no file of it either: its stdout is the MCP stream", () => {
    const touched = [...reachable(join(src, "browser", "launcher.ts"))].filter((file) =>
      file.startsWith(`${ui}/`),
    );
    expect(touched).toEqual([]);
  });

  test("the walk finds the module where it is imported: the CLI entry", () => {
    expect(reachable(join(entries, "cli.ts")).has(join(ui, "out.ts"))).toBe(true);
  });
});
