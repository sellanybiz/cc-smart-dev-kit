/**
 * HO1 probe: what decides the auto-compact window of a session, proved with `/context`.
 *
 * `claude -p "/context"` is a local command: it makes no model call, costs nothing and prints
 * the window ("Tokens: used / window") and the "Autocompact buffer" row. A crew session may run
 * it (it may not run `claude --bg`). The probe reads the person's real `~/.claude/settings.json`
 * through Claude Code itself and never writes to it: each case adds only an extra `--settings`
 * file in a temp folder, and a shell variable for the env cases.
 *
 * Cases, for one model (default `claude-opus-5-5`):
 *   A  no flag                              the person's own settings apply
 *   B  --autocompact auto                   the settings must NOT apply (expected: model default)
 *   C  --autocompact 250k                   the flag wins (expected: window 250k)
 *   D  --autocompact auto + env 300k        the variable still applies under `auto`
 *   E  --autocompact auto + env 300k +
 *      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50   the compaction point is lowered to a share
 *   F  --autocompact auto, --settings file whose env sets the variable to 300k
 *
 * Run: `bun .claude/research/ho1-autocompact/probe.ts [model]`
 * It prints one block per case: the "Tokens:" line and the "Autocompact buffer" row.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const model = process.argv[2] ?? "claude-opus-5-5";
const folder = mkdtempSync(join(tmpdir(), "ho1-autocompact-"));
mkdirSync(folder, { recursive: true });
const envSettings = join(folder, "env-settings.json");
writeFileSync(envSettings, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" } }));

type Case = { name: string; args: string[]; env?: Record<string, string> };
const cases: Case[] = [
  { name: "A no flag", args: [] },
  { name: "B --autocompact auto", args: ["--autocompact", "auto"] },
  { name: "C --autocompact 250k", args: ["--autocompact", "250k"] },
  {
    name: "D auto + CLAUDE_CODE_AUTO_COMPACT_WINDOW=300k",
    args: ["--autocompact", "auto"],
    env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" },
  },
  {
    name: "E auto + window 300k + CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50",
    args: ["--autocompact", "auto"],
    env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "50", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" },
  },
  {
    name: "F auto + --settings env 300k",
    args: ["--autocompact", "auto", "--settings", envSettings],
  },
];

for (const one of cases) {
  const run = Bun.spawnSync(
    [
      "claude",
      "-p",
      "/context",
      "--model",
      model,
      "--effort",
      "medium",
      "--output-format",
      "json",
      ...one.args,
    ],
    { cwd: folder, env: { ...process.env, ...one.env } },
  );
  const text = run.stdout.toString();
  let result = text;
  try {
    result = (JSON.parse(text) as { result?: string }).result ?? text;
  } catch {
    // keep the raw text
  }
  const lines = result.split("\n").filter((line) => /^\*\*Tokens|Autocompact buffer/.test(line));
  console.log(`${one.name}\n  ${lines.join("\n  ") || `(no match, exit ${run.exitCode})`}`);
}
