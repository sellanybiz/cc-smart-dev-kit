/**
 * PreToolUse on `mcp__playwright__*`: a screenshot or snapshot the caller names by a relative
 * `filename` is put in the browser's output folder.
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
 *   `./x.png` is read as `x.png`.
 *
 *   A relative name with a `..` segment (`../x.png`) is REFUSED (`deny`, with the reason
 *   shown to Claude): the server no longer stops it — `--allow-unrestricted-file-access` is
 *   what lets it take a path from any worktree — so this hook is the only thing between the
 *   call and a file written wherever the name points.
 *
 *   It answers with `updatedInput` and NO permission decision, so the call still goes through
 *   the normal permission flow (proved live: `docs/claude-code-contract.md` § Hooks).
 *
 *   ONLY THE PLUGIN'S OWN SERVER: an MCP server named `playwright` may be the person's own
 *   (registered by them, or by a project's `.mcp.json`), with an output folder of its own.
 *   The rewrite and the refusal happen only while the live `playwright` registration is the
 *   one setup recorded — a record in `<stateDir>/mcp-servers.json` that is not `pending` and
 *   that the user config still holds as it was (proved live: `docs/claude-code-contract.md`
 *   § MCP servers — the stored config is the given JSON). Otherwise this hook answers
 *   nothing at all: the reads only happen for a relative `filename` a rewrite is possible
 *   for, so an ordinary browser call pays nothing.
 *
 *   LEFT ALONE: a call with no `filename`, an EMPTY one, and an ABSOLUTE path — a caller that
 *   named a place meant it.
 *
 * A `USER_HOOKS` bundle: it never enters the frame, reads no cc-smart-dev-kit.json and takes no
 * `ownHooks` — it is about the machine's browser, like `notify` is about its alerts.
 * Wired from `plugin/hooks/hooks.json` → PreToolUse (matcher `mcp__playwright__.*`).
 */
import { isAbsolute, resolve, sep } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { readMcpRecords } from "../mcp/records";
import { readUserServers, sameConfig } from "../mcp/register";
import {
  type HookInput,
  type HookResult,
  parseHookInput,
  SILENT,
  toolDecision,
  toolInput,
} from "./io";

/** The rewritten `filename` for a call, or null when this call's name is left alone. */
export function outputFilename(fields: Record<string, unknown>, outputDir: string): null | string {
  const filename = fields["filename"];
  if (typeof filename !== "string" || filename === "" || isAbsolute(filename)) return null;
  // `./x.png` means `x.png` in that folder.
  const name = filename.replace(/^(?:\.[\\/])+/, "");
  const target = resolve(outputDir, name);
  if (!target.startsWith(outputDir + sep)) return null;
  return target;
}

/** Does a relative `filename` climb out of the folder it would be resolved in? */
export function climbsOut(filename: string): boolean {
  return filename.split(/[\\/]+/).includes("..");
}

/** The reason a climbing name is refused, shown to Claude. */
export function outsideReason(filename: string, outputDir: string): string {
  return (
    `This call names a file outside the browser's output folder ("filename": ${JSON.stringify(filename)} — a path with ".." in it). ` +
    `Files the browser saves live in ${outputDir}. Name the file with a relative name (it lands there), or use an absolute path inside that folder.`
  );
}

/** The answer that rewrites one call's `filename`. */
export function rewrittenAnswer(input: HookInput, filename: string): HookResult {
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
 * Is the live `playwright` registration the one setup recorded? False when the record is
 * gone, is marked `pending` (an update was in flight), or the user config holds something
 * else under that name — then the server is a person's own, and this hook keeps out of it.
 */
export function playwrightIsOurs(paths: CliPaths): boolean {
  let record: { json: string; pending?: boolean } | undefined;
  try {
    record = readMcpRecords(paths.stateDir).playwright;
  } catch {
    // The record file does not read: nothing can be said to be ours.
    return false;
  }
  if (record === undefined || record.pending === true) return false;
  const live = readUserServers(paths.userConfigFile);
  return live !== null && sameConfig(record.json, live.playwright);
}

/** The `filename` of a call this hook could rewrite, or null when the call is left alone. */
function rewritableFilename(input: HookInput): null | string {
  const filename = toolInput(input)["filename"];
  return typeof filename === "string" && filename !== "" && !isAbsolute(filename) ? filename : null;
}

/** The answer for one call: the rewritten input, a refusal, or nothing. */
export function playwrightOutputAnswer(
  input: HookInput,
  outputDir: string,
  ours: boolean,
): HookResult {
  if (!ours) return SILENT;
  const filename = rewritableFilename(input);
  if (filename === null) return SILENT;
  if (climbsOut(filename)) return toolDecision("deny", outsideReason(filename, outputDir));
  const target = outputFilename(toolInput(input), outputDir);
  return target === null ? SILENT : rewrittenAnswer(input, target);
}

/**
 * One hook run: stdin in, the answer out, then exit. Never throws: a browser call must not
 * fail on this hook's own bug.
 */
export async function playwrightOutput(paths: CliPaths = cliPaths(process.env)): Promise<never> {
  let answer: HookResult = SILENT;
  try {
    const input = parseHookInput(await Bun.stdin.text());
    // The cheap exit first: a call with no relative name reads no file at all (this runs on
    // every `mcp__playwright__*` call).
    if (input !== null && rewritableFilename(input) !== null && playwrightIsOurs(paths)) {
      answer = playwrightOutputAnswer(input, paths.browserOutputDir, true);
    }
  } catch (error) {
    console.error(
      `cc-smart-dev-kit playwright-output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (answer.stdout !== undefined) await Bun.write(Bun.stdout, answer.stdout);
  process.exit(answer.exitCode ?? 0);
}
