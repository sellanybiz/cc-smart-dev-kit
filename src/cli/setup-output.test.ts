/**
 * What `setup` prints, whole, on one fake machine (`src/testing/fake-machine.ts`): a fresh
 * machine, the same machine with nothing left to change, and a dry run — plain (a pipe, a log),
 * rich (a terminal: colour on the marks and the verdict, wrapped at its width, a progress line
 * while the slow step runs), and an old Windows console (ASCII). The expected text is written
 * out by hand: this is the contract a person reads.
 */
import { describe, expect, test } from "bun:test";
import { VERSION } from "../build-info";
import { world } from "../testing/fake-machine";
import { createOut, textSink } from "./ui/out";
import { detectTerminal, type Terminal } from "./ui/terminal";

const PLAIN: Terminal = detectTerminal({ env: {}, isTTY: false, platform: "linux" });
const RICH: Terminal = detectTerminal({ columns: 100, env: {}, isTTY: true, platform: "linux" });
const OLD_WINDOWS: Terminal = detectTerminal({
  columns: 100,
  env: {},
  isTTY: true,
  platform: "win32",
});

/** Setup on a fresh fake machine (no terminal to ask on), printing to `term`; its text, per run. */
function machine() {
  // The fake `claude` keeps what `claude mcp` registers, so a second run has nothing to add.
  const w = world({ answer: null, mcp: true });
  const run = async (term: Terminal, dryRun = false) => {
    let text = "";
    const out = createOut(
      term,
      textSink((part) => {
        text += part;
      }),
    );
    const code = await w.setup({ dryRun, out });
    return { code, text };
  };
  return { home: w.home, run };
}

// The colours, by hand: green, yellow, cyan, dim, bold, and the reset.
const G = (text: string) => `\x1b[32m${text}\x1b[0m`;
const Y = (text: string) => `\x1b[33m${text}\x1b[0m`;
const C = (text: string) => `\x1b[36m${text}\x1b[0m`;
const D = (text: string) => `\x1b[2m${text}\x1b[0m`;
const B = (text: string) => `\x1b[1m${text}\x1b[0m`;
/** The progress line of the one slow step, drawn and then cleared (a terminal shows nothing of it after). */
const PROGRESS = "\r\x1b[2K⠋ Registering the MCP servers and writing the settings…\r\x1b[2K";

const lines = (...all: string[]) => `${all.join("\n")}\n`;

describe("setup's report, plain", () => {
  test("a fresh machine: sections in order, each change with its mark, the verdict, the next steps", async () => {
    const { run } = machine();
    const { code, text } = await run(PLAIN);
    expect(code).toBe(0);
    expect(text).toBe(
      lines(
        `cc-smart-dev-kit ${VERSION}: setting up this machine`,
        "",
        "✓ The command           1 change",
        "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
        "✓ Claude Code settings  3 changes",
        '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
        '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"',
        '  ~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        "✓ Instructions          3 changes",
        "  + ~/.claude/cc-smart-dev-kit/instructions/core.md: created",
        "  + ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
        "  + ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
        "! Companion plugins     2 changes, 1 warning",
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"',
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"',
        `  ! claude-mem's work state goes off: its to-do lists are no longer shown in a session. Read one first with claude-mem's work_state_read tool, or turn work state back on by setting CLAUDE_MEM_WORK_STATE_ENABLED to "true" in ~/.claude-mem/settings.json.`,
        "! MCP servers           2 changes, 1 warning",
        "  + MCP server playwright registered for your user",
        "  + MCP server sequential-thinking registered for your user",
        "  ! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again",
        "· Browser               1 note",
        "  · the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open",
        "",
        "! Done: 11 changes, with 2 warnings to read above. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "",
        "Next steps:",
        "  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: add this line to ~/.profile, then open a new terminal:",
        '       export PATH="$HOME/.local/bin:$PATH"',
        '  2. Finish the browser: this opens Chrome in the "claude-code" profile and walks you through steps 1, 2, 5:',
        "       cc-smart-dev-kit browser setup",
        "  3. Start a new Claude Code session (and restart the ones running): a session reads its settings, instructions, plugins and MCP servers when it starts. claude-mem's start hook reads its new settings then too, and its worker reads them when it starts.",
      ),
    );
  });

  test("nothing to change: only what is still to read, the verdict, and the steps still open", async () => {
    const { run } = machine();
    await run(PLAIN);
    const { code, text } = await run(PLAIN);
    expect(code).toBe(0);
    expect(text).toBe(
      lines(
        `cc-smart-dev-kit ${VERSION}: setting up this machine`,
        "",
        "! MCP servers           1 warning",
        "  ! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again",
        "· Browser               1 note",
        "  · the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open",
        "",
        "! Nothing to change. Setup is up to date, with 1 warning to read above.",
        "",
        "Next steps:",
        "  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: add this line to ~/.profile, then open a new terminal:",
        '       export PATH="$HOME/.local/bin:$PATH"',
        '  2. Finish the browser: this opens Chrome in the "claude-code" profile and walks you through steps 1, 2, 5:',
        "       cc-smart-dev-kit browser setup",
      ),
    );
  });

  test("a dry run: the same sections as what a real run would do, the count, and the one ending", async () => {
    const { home, run } = machine();
    const { code, text } = await run(PLAIN, true);
    expect(code).toBe(0);
    expect(text).toBe(
      lines(
        `cc-smart-dev-kit ${VERSION}: what setup would change (dry run)`,
        "",
        "· The command           1 to change",
        "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
        "· Claude Code settings  3 to change",
        '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
        '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"',
        '  ~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        "· Instructions          3 to change",
        "  + ~/.claude/cc-smart-dev-kit/instructions/core.md: created",
        "  + ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
        "  + ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
        "! Companion plugins     2 to change, 1 warning",
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"',
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"',
        `  ! claude-mem's work state goes off: its to-do lists are no longer shown in a session. Read one first with claude-mem's work_state_read tool, or turn work state back on by setting CLAUDE_MEM_WORK_STATE_ENABLED to "true" in ~/.claude-mem/settings.json.`,
        "! MCP servers           2 to change, 1 warning",
        `  $ claude mcp add-json --scope user playwright {"command":"${home}/.local/bin/cc-smart-dev-kit","args":["browser","mcp"]}`,
        '  $ claude mcp add-json --scope user sequential-thinking {"args":["-y","@modelcontextprotocol/server-sequential-thinking@2026.8.31"],"command":"bunx"}',
        "  ! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again",
        "· Browser               1 note",
        "  · the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open",
        "",
        "· A real run makes 11 changes.",
        "Dry run: nothing was written or run.",
      ),
    );
  });
});

describe("setup's report, on a terminal", () => {
  test("a fresh machine: the same words, coloured marks, wrapped at 100 columns, the progress line cleared", async () => {
    const { run } = machine();
    const { code, text } = await run(RICH);
    expect(code).toBe(0);
    expect(text).toBe(
      lines(
        B(`cc-smart-dev-kit ${VERSION}: setting up this machine`),
        "",
        `${PROGRESS}${G("✓")} The command           1 change`,
        `  ${G("+")} ~/.local/bin/cc-smart-dev-kit: launcher created`,
        `${G("✓")} Claude Code settings  3 changes`,
        `  ${Y("~")} ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false`,
        `  ${Y("~")} ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"`,
        `  ${Y("~")} ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook`,
        '    ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        `${G("✓")} Instructions          3 changes`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/core.md: created`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created`,
        `  ${G("+")} ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block`,
        `${Y("!")} Companion plugins     2 changes, 1 warning`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"`,
        `  ${Y("!")} claude-mem's work state goes off: its to-do lists are no longer shown in a session. Read one`,
        "    first with claude-mem's work_state_read tool, or turn work state back on by setting",
        '    CLAUDE_MEM_WORK_STATE_ENABLED to "true" in ~/.claude-mem/settings.json.',
        `${Y("!")} MCP servers           2 changes, 1 warning`,
        `  ${G("+")} MCP server playwright registered for your user`,
        `  ${G("+")} MCP server sequential-thinking registered for your user`,
        `  ${Y("!")} tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key`,
        "    file: put the key there (chmod 600), or set the variable, then run setup again",
        `${D("·")} Browser               1 note`,
        `  ${D("·")} the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open`,
        "",
        Y("! Done: 11 changes, with 2 warnings to read above. Each changed file has a backup in"),
        Y("  ~/.claude/cc-smart-dev-kit/backups/."),
        "",
        "Next steps:",
        "  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: add this line to",
        "     ~/.profile, then open a new terminal:",
        '       export PATH="$HOME/.local/bin:$PATH"',
        '  2. Finish the browser: this opens Chrome in the "claude-code" profile and walks you through steps',
        "     1, 2, 5:",
        "       cc-smart-dev-kit browser setup",
        "  3. Start a new Claude Code session (and restart the ones running): a session reads its settings,",
        "     instructions, plugins and MCP servers when it starts. claude-mem's start hook reads its new",
        "     settings then too, and its worker reads them when it starts.",
      ),
    );
  });

  test("nothing to change", async () => {
    const { run } = machine();
    await run(PLAIN);
    const { text } = await run(RICH);
    expect(text).toBe(
      lines(
        B(`cc-smart-dev-kit ${VERSION}: setting up this machine`),
        "",
        `${PROGRESS}${Y("!")} MCP servers           1 warning`,
        `  ${Y("!")} tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key`,
        "    file: put the key there (chmod 600), or set the variable, then run setup again",
        `${D("·")} Browser               1 note`,
        `  ${D("·")} the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open`,
        "",
        Y("! Nothing to change. Setup is up to date, with 1 warning to read above."),
        "",
        "Next steps:",
        "  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: add this line to",
        "     ~/.profile, then open a new terminal:",
        '       export PATH="$HOME/.local/bin:$PATH"',
        '  2. Finish the browser: this opens Chrome in the "claude-code" profile and walks you through steps',
        "     1, 2, 5:",
        "       cc-smart-dev-kit browser setup",
      ),
    );
  });

  test("a dry run: no progress line (nothing slow runs), a command is a $ line, dim verdict", async () => {
    const { home, run } = machine();
    const { text } = await run(RICH, true);
    expect(text).toBe(
      lines(
        B(`cc-smart-dev-kit ${VERSION}: what setup would change (dry run)`),
        "",
        `${D("·")} The command           1 to change`,
        `  ${G("+")} ~/.local/bin/cc-smart-dev-kit: launcher created`,
        `${D("·")} Claude Code settings  3 to change`,
        `  ${Y("~")} ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false`,
        `  ${Y("~")} ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"`,
        `  ${Y("~")} ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook`,
        '    ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        `${D("·")} Instructions          3 to change`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/core.md: created`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created`,
        `  ${G("+")} ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block`,
        `${Y("!")} Companion plugins     2 to change, 1 warning`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"`,
        `  ${Y("!")} claude-mem's work state goes off: its to-do lists are no longer shown in a session. Read one`,
        "    first with claude-mem's work_state_read tool, or turn work state back on by setting",
        '    CLAUDE_MEM_WORK_STATE_ENABLED to "true" in ~/.claude-mem/settings.json.',
        `${Y("!")} MCP servers           2 to change, 1 warning`,
        `  ${C("$")} claude mcp add-json --scope user playwright`,
        `    {"command":"${home}/.local/bin/cc-smart-dev-kit","args":["browser","mcp"]}`,
        `  ${C("$")} claude mcp add-json --scope user sequential-thinking`,
        '    {"args":["-y","@modelcontextprotocol/server-sequential-thinking@2026.8.31"],"command":"bunx"}',
        `  ${Y("!")} tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key`,
        "    file: put the key there (chmod 600), or set the variable, then run setup again",
        `${D("·")} Browser               1 note`,
        `  ${D("·")} the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open`,
        "",
        D("· A real run makes 11 changes."),
        "Dry run: nothing was written or run.",
      ),
    );
  });

  test("an old Windows console: ASCII marks and words, no colour", async () => {
    const { run } = machine();
    await run(PLAIN);
    const { text } = await run(OLD_WINDOWS);
    expect(text).toBe(
      lines(
        `cc-smart-dev-kit ${VERSION}: setting up this machine`,
        "",
        "\r\x1b[2K| Registering the MCP servers and writing the settings...\r\x1b[2K[!] MCP servers           1 warning",
        "  [!] tavily-websearch: skipped - no TAVILY_API_KEY in the environment, in the settings, or in a key",
        "      file: put the key there (chmod 600), or set the variable, then run setup again",
        "[i] Browser               1 note",
        "  [i] the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open",
        "",
        "[!] Nothing to change. Setup is up to date, with 1 warning to read above.",
        "",
        "Next steps:",
        "  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: add this line to",
        "     ~/.profile, then open a new terminal:",
        '       export PATH="$HOME/.local/bin:$PATH"',
        '  2. Finish the browser: this opens Chrome in the "claude-code" profile and walks you through steps',
        "     1, 2, 5:",
        "       cc-smart-dev-kit browser setup",
      ),
    );
  });
});
