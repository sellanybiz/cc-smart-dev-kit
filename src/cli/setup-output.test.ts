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
        "Task tools: trust rule for permissions.allow:",
        '  + "mcp__cc-smart-dev-kit-tasks__*"',
        "",
        "✓ The command           1 change",
        "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
        "✓ Claude Code settings  9 changes, 3 notes",
        '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
        "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
        '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: (none) -> "10"',
        '  ~ ~/.claude/settings.json: task permission added "TaskCreate"',
        '  ~ ~/.claude/settings.json: task permission added "TaskUpdate"',
        '  ~ ~/.claude/settings.json: task permission added "TaskList"',
        '  ~ ~/.claude/settings.json: task permission added "TaskGet"',
        '  ~ ~/.claude/settings.json: task permission added "TodoWrite"',
        '  ~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        "  · task tools allow rule left out: trust rules need a person at a terminal",
        "  · max subagents: 10 (set by cc-smart-dev-kit); to change it, run: cc-smart-dev-kit setup --max-subagents <n> (1–100)",
        "  · retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on",
        "✓ Instructions          3 changes",
        "  + ~/.claude/cc-smart-dev-kit/instructions/core.md: created",
        "  + ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
        "  + ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
        "✓ Companion plugins     2 changes",
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"',
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"',
        "! MCP servers           3 changes, 1 warning",
        "  + MCP server playwright registered for your user",
        "  + MCP server sequential-thinking registered for your user",
        "  + MCP server cc-smart-dev-kit-tasks registered for your user",
        "  ! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again",
        "· Browser               1 note",
        "  · the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open",
        "",
        "! Done: 18 changes, with 1 warning to read above. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
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
        "Task tools: trust rule for permissions.allow:",
        '  + "mcp__cc-smart-dev-kit-tasks__*"',
        "",
        "· Claude Code settings  2 notes",
        "  · task tools allow rule left out: trust rules need a person at a terminal",
        "  · retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on",
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
        "· Claude Code settings  9 to change, 3 notes",
        '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
        "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
        '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: (none) -> "10"',
        '  ~ ~/.claude/settings.json: task permission added "TaskCreate"',
        '  ~ ~/.claude/settings.json: task permission added "TaskUpdate"',
        '  ~ ~/.claude/settings.json: task permission added "TaskList"',
        '  ~ ~/.claude/settings.json: task permission added "TaskGet"',
        '  ~ ~/.claude/settings.json: task permission added "TodoWrite"',
        '  ~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        "  · task tools allow rule left out: trust rules need a person at a terminal",
        "  · would set max subagents: 10; to change it, run: cc-smart-dev-kit setup --max-subagents <n> (1–100)",
        "  · retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on",
        "· Instructions          3 to change",
        "  + ~/.claude/cc-smart-dev-kit/instructions/core.md: created",
        "  + ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
        "  + ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
        "· Companion plugins     2 to change",
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"',
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"',
        "! MCP servers           3 to change, 1 warning",
        `  $ claude mcp add-json --scope user playwright {"command":"${home}/.local/bin/cc-smart-dev-kit","args":["browser","mcp"]}`,
        '  $ claude mcp add-json --scope user sequential-thinking {"args":["-y","@modelcontextprotocol/server-sequential-thinking@2026.8.31"],"command":"bunx"}',
        `  $ claude mcp add-json --scope user cc-smart-dev-kit-tasks {"command":"${home}/.local/bin/cc-smart-dev-kit","args":["task","mcp"],"alwaysLoad":true}`,
        "  ! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again",
        "· Browser               1 note",
        "  · the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open",
        "",
        "· A real run makes 18 changes.",
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
        "Task tools: trust rule for permissions.allow:",
        `  ${G("+")} "mcp__cc-smart-dev-kit-tasks__*"`,
        "",
        `${PROGRESS}${G("✓")} The command           1 change`,
        `  ${G("+")} ~/.local/bin/cc-smart-dev-kit: launcher created`,
        `${G("✓")} Claude Code settings  9 changes, 3 notes`,
        `  ${Y("~")} ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false`,
        `  ${Y("~")} ~/.claude/settings.json: remoteControlAtStartup: (none) -> true`,
        `  ${Y("~")} ~/.claude/settings.json: env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: (none) -> "10"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskCreate"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskUpdate"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskList"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskGet"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TodoWrite"`,
        `  ${Y("~")} ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook`,
        '    ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        `  ${D("·")} task tools allow rule left out: trust rules need a person at a terminal`,
        `  ${D("·")} max subagents: 10 (set by cc-smart-dev-kit); to change it, run: cc-smart-dev-kit setup`,
        "    --max-subagents <n> (1–100)",
        `  ${D("·")} retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on`,
        `${G("✓")} Instructions          3 changes`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/core.md: created`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created`,
        `  ${G("+")} ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block`,
        `${G("✓")} Companion plugins     2 changes`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"`,
        `${Y("!")} MCP servers           3 changes, 1 warning`,
        `  ${G("+")} MCP server playwright registered for your user`,
        `  ${G("+")} MCP server sequential-thinking registered for your user`,
        `  ${G("+")} MCP server cc-smart-dev-kit-tasks registered for your user`,
        `  ${Y("!")} tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key`,
        "    file: put the key there (chmod 600), or set the variable, then run setup again",
        `${D("·")} Browser               1 note`,
        `  ${D("·")} the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open`,
        "",
        Y("! Done: 18 changes, with 1 warning to read above. Each changed file has a backup in"),
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
        "Task tools: trust rule for permissions.allow:",
        `  ${G("+")} "mcp__cc-smart-dev-kit-tasks__*"`,
        "",
        `${PROGRESS}${D("·")} Claude Code settings  2 notes`,
        `  ${D("·")} task tools allow rule left out: trust rules need a person at a terminal`,
        `  ${D("·")} retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on`,
        `${Y("!")} MCP servers           1 warning`,
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
        `${D("·")} Claude Code settings  9 to change, 3 notes`,
        `  ${Y("~")} ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false`,
        `  ${Y("~")} ~/.claude/settings.json: remoteControlAtStartup: (none) -> true`,
        `  ${Y("~")} ~/.claude/settings.json: env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: (none) -> "10"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskCreate"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskUpdate"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskList"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TaskGet"`,
        `  ${Y("~")} ~/.claude/settings.json: task permission added "TodoWrite"`,
        `  ${Y("~")} ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook`,
        '    ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)',
        `  ${D("·")} task tools allow rule left out: trust rules need a person at a terminal`,
        `  ${D("·")} would set max subagents: 10; to change it, run: cc-smart-dev-kit setup --max-subagents <n>`,
        "    (1–100)",
        `  ${D("·")} retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on`,
        `${D("·")} Instructions          3 to change`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/core.md: created`,
        `  ${G("+")} ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created`,
        `  ${G("+")} ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block`,
        `${D("·")} Companion plugins     2 to change`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"`,
        `  ${Y("~")} ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"`,
        `${Y("!")} MCP servers           3 to change, 1 warning`,
        `  ${C("$")} claude mcp add-json --scope user playwright`,
        `    {"command":"${home}/.local/bin/cc-smart-dev-kit","args":["browser","mcp"]}`,
        `  ${C("$")} claude mcp add-json --scope user sequential-thinking`,
        '    {"args":["-y","@modelcontextprotocol/server-sequential-thinking@2026.8.31"],"command":"bunx"}',
        `  ${C("$")} claude mcp add-json --scope user cc-smart-dev-kit-tasks`,
        `    {"command":"${home}/.local/bin/cc-smart-dev-kit","args":["task","mcp"],"alwaysLoad":true}`,
        `  ${Y("!")} tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key`,
        "    file: put the key there (chmod 600), or set the variable, then run setup again",
        `${D("·")} Browser               1 note`,
        `  ${D("·")} the browser is NOT ready: steps 1, 2, 5 of cc-smart-dev-kit browser setup are open`,
        "",
        D("· A real run makes 18 changes."),
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
        "Task tools: trust rule for permissions.allow:",
        '  + "mcp__cc-smart-dev-kit-tasks__*"',
        "",
        "\r\x1b[2K| Registering the MCP servers and writing the settings...\r\x1b[2K[i] Claude Code settings  2 notes",
        "  [i] task tools allow rule left out: trust rules need a person at a terminal",
        "  [i] retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on",
        "[!] MCP servers           1 warning",
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
