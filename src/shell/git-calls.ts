/**
 * How git reads its own options before the subcommand (`git -C dir -c k=v --work-tree w commit`):
 * the one home of that list. The git guard, the merge reader and the main-folder guard all read
 * a git command line through `gitCalls`, so a spelling git accepts is fixed here and nowhere else.
 */

/**
 * True when `arg` is the long option `full`, or a prefix of it that git accepts (git takes
 * any unique prefix: `--har` is `--hard`, `--force-w` is `--force-with-lease`). `min` is the
 * shortest prefix that still names one option of that subcommand.
 */
export function longOption(arg: string, full: string, min: number): boolean {
  const name = arg.split("=")[0] ?? arg;
  return name.length >= min && name.length <= full.length && full.startsWith(name);
}

/** A config key as git compares it: section and key lowercase, a subsection as it is. */
function configKey(raw: string): string {
  const parts = raw.split(".");
  if (parts.length < 2) return raw.toLowerCase();
  const first = (parts[0] ?? "").toLowerCase();
  const last = (parts[parts.length - 1] ?? "").toLowerCase();
  return [first, ...parts.slice(1, -1), last].join(".");
}

/** git's own options that take the next word as their value (git 2.53, `git --help`). */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--attr-source",
  "--config-env",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
]);

/** git's own options that take no value. git takes no abbreviation of any of them. */
const GIT_FLAGS = new Set([
  "-P",
  "-p",
  "--bare",
  "--glob-pathspecs",
  "--icase-pathspecs",
  "--literal-pathspecs",
  "--no-advice",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "--noglob-pathspecs",
  "--paginate",
]);

/** git's own options after which git prints something and runs no subcommand. */
const GIT_PRINTS = new Set([
  "-h",
  "-v",
  "--exec-path",
  "--help",
  "--html-path",
  "--info-path",
  "--man-path",
  "--version",
]);

/** One way git may read its own options: where it runs, its subcommand, and its `-c` settings. */
export interface GitCall {
  /** The folders `-C` moves to, in order (each relative to the one before). */
  dirs: string[];
  /** `--work-tree`'s value (the last one given), else null. */
  workTree: string | null;
  sub: string;
  rest: string[];
  /** `-c key=value` on the line, key → value; a `--config-env` value (read from the environment) is null. */
  config: Map<string, string | null>;
}

/**
 * The subcommand git runs and its arguments, behind git's own options (`git -C dir
 * --config-env k=ENV push …`). One reading, or none when git only prints (`git --version`).
 * After an option this guard does not know (a newer git's, which may take values), every
 * later word may be the subcommand, so each is one reading: a guard asks if any of them
 * would. The one home of git's option list: the merge reader reads it too.
 */
export function gitCalls(args: readonly string[]): GitCall[] {
  const dirs: string[] = [];
  const config = new Map<string, string | null>();
  let workTree: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const name = arg.startsWith("--") ? (arg.split("=")[0] ?? arg) : arg;
    const attached = arg.startsWith("--") && arg.includes("=");
    if (arg === "-C") {
      const dir = args[++index];
      if (dir !== undefined) dirs.push(dir);
    } else if (arg === "-c" || name === "--config-env") {
      const setting = attached ? arg.slice(name.length + 1) : (args[++index] ?? "");
      const equals = setting.indexOf("=");
      const key = configKey(equals === -1 ? setting : setting.slice(0, equals));
      config.set(key, arg === "-c" ? (equals === -1 ? "true" : setting.slice(equals + 1)) : null);
    } else if (name === "--work-tree") {
      workTree = (attached ? arg.slice(name.length + 1) : args[++index]) ?? workTree;
    } else if (GIT_VALUE_OPTIONS.has(arg)) {
      index++;
    } else if (GIT_PRINTS.has(arg) || name === "--list-cmds") {
      return [];
    } else if ((attached && GIT_VALUE_OPTIONS.has(name)) || name === "--exec-path") {
      // `--git-dir=x`, `--exec-path=x`: one word.
    } else if (!GIT_FLAGS.has(arg) && arg.startsWith("-")) {
      const later = args.slice(index + 1);
      return later.flatMap((word, at) =>
        word.startsWith("-")
          ? []
          : [{ config, dirs: [...dirs], rest: later.slice(at + 1), sub: word, workTree }],
      );
    } else if (!arg.startsWith("-")) {
      return [{ config, dirs, rest: args.slice(index + 1), sub: arg, workTree }];
    }
  }
  return [];
}
