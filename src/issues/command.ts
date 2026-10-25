/**
 * `cc-smart-dev-kit issue file --title <t> --body-file <f|-> --fingerprint <key> [--label <l>…]`
 * (decision D67). Files one finding as a GitHub issue in the project's own repository, or
 * updates the issue the same fingerprint already filed (`file.ts`), and prints ONE line:
 * `filed #<n> <url>`, `updated #<n> <url>`, or `refused: <why>`. Exit codes: 0 filed or
 * updated, 1 refused, 2 a command line that is not one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { type GhExec, runGh } from "../workflow/merge-check";
import { fileIssue, type IssueRequest, issueLine } from "./file";
import { listFixed, openGate } from "./fixed";

export const ISSUE_USAGE = `Usage: ${COMMAND} issue file --title <title> --body-file <file|-> --fingerprint <key> [--label <label>…]
       ${COMMAND} issue fixed --base <branch> --head <branch>

Files one finding as a GitHub issue in this project's own repository (the one \`origin\` names,
on github.com), and prints one line: filed #<n> <url>, updated #<n> <url>, or refused: <why>.
The same --fingerprint again updates the issue it filed (its body) and opens no second one: the
key is hashed into a hidden comment at the end of the body. --body-file - reads the body from
standard input. --label adds a label beside the found label; a label the repository lacks is
created.

It files nothing unless issues.enabled is on (off by default; read from your own workflow.json
and the project's file as committed on the base), and a public repository needs issues.allowPublic
too. A title or body that holds a home path (in any spelling of it), a key or token of a known
shape or a value after key, token, secret or password, or a URL with credentials is refused with
its line and column, and nothing is sent. The screen knows those shapes only: read a text before
you file it.

issue fixed prints one \`Fixes #<n>\` line for each open issue the kit marked fixed (it carries the
label issues.fixedLabel) whose fix is in <base>..<head>: the lines a release's pull request body
carries, so GitHub closes those issues when it merges into the default branch. It prints nothing
when the switch is off or no issue is listed, and exits 1 (the reason on standard error) when
GitHub or the branches cannot be read: an empty list from a failed call would look complete.`;

type Env = Record<string, string | undefined>;

export interface IssueContext {
  cwd: string;
  env: Env;
  error: (line: string) => void;
  /** The `gh` the command starts; the real one when left out. */
  gh?: GhExec;
  paths: CliPaths;
  print: (line: string) => void;
  /** Standard input, whole; for `--body-file -`. */
  readStdin: () => Promise<string>;
}

/** The request a command line asks for, or why it is not one. */
type Parsed =
  | { bodyFile: string; ok: true; request: Omit<IssueRequest, "body"> }
  | { ok: false; why: string };

/** The options of one command, each with its values in the order given; or why the line is not one. */
function parseOptions(
  argv: string[],
  valued: readonly string[],
): { given: Record<string, string[]>; ok: true } | { ok: false; why: string } {
  const given: Record<string, string[]> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const at = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = at === -1 ? arg : arg.slice(0, at);
    if (!valued.includes(name)) {
      return { ok: false, why: `Unknown option: ${arg}` };
    }
    const value = at === -1 ? argv[index + 1] : arg.slice(at + 1);
    // A value may start with `-` only after `=`; the next word that starts `--` is an option.
    if (value === undefined || (at === -1 && value.startsWith("--"))) {
      return { ok: false, why: `${name} needs a value` };
    }
    if (at === -1) index += 1;
    given[name] = [...(given[name] ?? []), value];
  }
  return { given, ok: true };
}

/** Each name is needed exactly once; the first that is not is said. */
function onceEach(given: Record<string, string[]>, names: readonly string[]): null | string {
  const bad = names.find((name) => (given[name]?.length ?? 0) !== 1);
  return bad === undefined ? null : `${bad} is needed, once`;
}

function parse(argv: string[]): Parsed {
  const read = parseOptions(argv, ["--title", "--body-file", "--fingerprint", "--label"]);
  if (!read.ok) return read;
  const { given } = read;
  const missing = onceEach(given, ["--title", "--body-file", "--fingerprint"]);
  if (missing !== null) return { ok: false, why: missing };
  return {
    bodyFile: given["--body-file"]?.[0] ?? "",
    ok: true,
    request: {
      fingerprint: given["--fingerprint"]?.[0] ?? "",
      labels: given["--label"] ?? [],
      title: given["--title"]?.[0] ?? "",
    },
  };
}

/** `issue fixed --base <b> --head <h>`: one `Fixes #<n>` line per issue; the exit code. */
async function runFixed(rest: string[], context: IssueContext): Promise<number> {
  const read = parseOptions(rest, ["--base", "--head"]);
  const missing = read.ok ? onceEach(read.given, ["--base", "--head"]) : read.why;
  if (!read.ok || missing !== null) {
    context.error(`${missing}\n\n${ISSUE_USAGE}`);
    return 2;
  }
  const world = {
    cwd: context.cwd,
    env: context.env,
    gh: context.gh ?? runGh,
    home: context.paths.home,
    paths: context.paths,
  };
  const gate = await openGate(world);
  // The switch is off here: there are no marked issues, so there is nothing to list.
  if (gate.kind === "off") return 0;
  if (gate.kind === "failed") {
    context.error(`issue fixed: ${gate.why}`);
    return 1;
  }
  const listed = await listFixed(gate, {
    base: read.given["--base"]?.[0] ?? "",
    head: read.given["--head"]?.[0] ?? "",
  });
  if (listed.kind === "failed") {
    context.error(`issue fixed: ${listed.why}`);
    return 1;
  }
  for (const number of listed.issues) context.print(`Fixes #${number}`);
  return 0;
}

/** `cc-smart-dev-kit issue …`; the exit code. */
export async function runIssue(argv: string[], context: IssueContext): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "fixed") return runFixed(rest, context);
  if (sub !== "file") {
    context.error(
      sub === undefined
        ? `issue needs a command\n\n${ISSUE_USAGE}`
        : `Unknown issue command: ${sub}\n\n${ISSUE_USAGE}`,
    );
    return 2;
  }
  const parsed = parse(rest);
  if (!parsed.ok) {
    context.error(`${parsed.why}\n\n${ISSUE_USAGE}`);
    return 2;
  }
  let body: string;
  try {
    body =
      parsed.bodyFile === "-"
        ? await context.readStdin()
        : readFileSync(resolve(context.cwd, parsed.bodyFile), "utf8");
  } catch (error) {
    context.error(
      `Cannot read the body: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  const outcome = await fileIssue(
    {
      cwd: context.cwd,
      env: context.env,
      gh: context.gh ?? runGh,
      home: context.paths.home,
      paths: context.paths,
    },
    { ...parsed.request, body },
  );
  context.print(issueLine(outcome));
  return outcome.kind === "refused" ? 1 : 0;
}
