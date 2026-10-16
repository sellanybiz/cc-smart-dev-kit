/**
 * PreToolUse on `mcp__playwright__*`: a screenshot or snapshot the caller names by a relative
 * `filename` is put in the shared browser's output folder.
 *
 * WHY IT EXISTS
 *   Playwright MCP has two rules for where a file lands. A file it names itself
 *   (`page-2026-….png`) goes to its output folder — the plugin starts it with
 *   `--output-dir=~/.local/share/cc-smart-dev-kit/playwright-output`. A file the CALLER names
 *   (`filename: "home-dark.png"`) is resolved against the folder the MCP process was started
 *   in, which is the folder the Claude session runs in: proved live on 0.0.83, the file lands
 *   beside the project's files. The server has no setting for it, and "remember the folder" is
 *   prose that already failed once in the project this was ported from (three `.gitignore`
 *   guesses at screenshot names).
 *
 * WHAT IT DOES
 *   A RELATIVE `filename` becomes an absolute path inside `cliPaths().browserOutputDir` —
 *   the folder the launcher passes as `--output-dir`, so the server accepts it from any
 *   worktree (the launcher also passes `--allow-unrestricted-file-access`). A name written as
 *   `./x.png` is read as `x.png`; a name that climbs out of the folder (`../x.png`) is left
 *   alone, and the server refuses it itself.
 *
 *   It answers with `updatedInput` and NO permission decision, so the call still goes through
 *   the normal permission flow (proved live: `docs/claude-code-contract.md` § Hooks).
 *
 *   LEFT ALONE: a call with no `filename`, and an ABSOLUTE path — a caller that named a place
 *   meant it. This hook is about the plugin's own browser server only (`mcp__playwright__*`);
 *   a project's own Playwright server has its own output folder and is none of its business.
 *
 * A `USER_HOOKS` bundle: it never enters the frame, reads no cc-smart-dev-kit.json and takes no
 * `ownHooks` — it is about the machine's shared browser, like `notify` is about its alerts.
 * Wired from `plugin/hooks/hooks.json` → PreToolUse (matcher `mcp__playwright__.*`).
 */
import { isAbsolute, resolve, sep } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { type HookInput, type HookResult, parseHookInput, SILENT, toolInput } from "./io";

/** The rewritten `filename` for a call, or null when this call is left alone. */
export function outputFilename(fields: Record<string, unknown>, outputDir: string): null | string {
  const filename = fields["filename"];
  if (typeof filename !== "string" || filename === "" || isAbsolute(filename)) return null;
  // `./x.png` means `x.png` in that folder.
  const name = filename.replace(/^(?:\.[\\/])+/, "");
  const target = resolve(outputDir, name);
  if (!target.startsWith(outputDir + sep)) return null;
  return target;
}

/** The answer for one call: the rewritten input, or nothing. */
export function playwrightOutputAnswer(input: HookInput, outputDir: string): HookResult {
  const filename = outputFilename(toolInput(input), outputDir);
  if (filename === null) return SILENT;
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...toolInput(input), filename },
      },
    }),
  };
}

/**
 * One hook run: stdin in, the answer out, then exit. Never throws: a browser call must not
 * fail on this hook's own bug.
 */
export async function playwrightOutput(paths: CliPaths = cliPaths(process.env)): Promise<never> {
  let answer: HookResult = SILENT;
  try {
    const input = parseHookInput(await Bun.stdin.text());
    if (input !== null) answer = playwrightOutputAnswer(input, paths.browserOutputDir);
  } catch (error) {
    console.error(
      `cc-smart-dev-kit playwright-output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (answer.stdout !== undefined) await Bun.write(Bun.stdout, answer.stdout);
  process.exit(answer.exitCode ?? 0);
}
