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
  /** `--git-dir`'s value (the last one given), else null. */
  gitDir: string | null;
  sub: string;
  rest: string[];
  /** `-c key=value` on the line, key → value; a `--config-env` value (read from the environment) is null. */
  config: Map<string, string | null>;
}

/**
 * The most readings `gitCalls` follows for options it does not know. Past it, such an option is
 * read as taking no value, so a line of thousands of them costs one reading each, not a tree.
 */
const MAX_READINGS = 16;

/** Where one reading of git's own options stands: what the options before `index` set. */
interface Reading {
  index: number;
  dirs: string[];
  config: Map<string, string | null>;
  workTree: string | null;
  gitDir: string | null;
}

/**
 * The subcommand git runs and its arguments, behind git's own options (`git -C dir
 * --config-env k=ENV push …`). One reading, or none when git only prints (`git --version`).
 * An option this reader does not know (a newer git's) takes at most one value, as every git
 * option does, so it gives two readings: it takes no value (the next word may be the
 * subcommand), or the next word is its value. A guard asks if any reading would. Each reading
 * slices the words once, and there are at most `MAX_READINGS`, so a long line stays linear.
 * The one home of git's option list: the merge reader reads it too.
 */
export function gitCalls(args: readonly string[]): GitCall[] {
  const calls: GitCall[] = [];
  const readings: Reading[] = [
    { config: new Map(), dirs: [], gitDir: null, index: 0, workTree: null },
  ];
  let started = 1;
  for (let next = readings.shift(); next !== undefined; next = readings.shift()) {
    const { config, dirs } = next;
    let { gitDir, workTree } = next;
    let index = next.index;
    for (; index < args.length; index++) {
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
      } else if (name === "--git-dir") {
        gitDir = (attached ? arg.slice(name.length + 1) : args[++index]) ?? gitDir;
      } else if (GIT_VALUE_OPTIONS.has(arg)) {
        index++;
      } else if (GIT_PRINTS.has(arg) || name === "--list-cmds") {
        break;
      } else if ((attached && GIT_VALUE_OPTIONS.has(name)) || name === "--exec-path") {
        // `--git-dir=x`, `--exec-path=x`: one word.
      } else if (GIT_FLAGS.has(arg)) {
        // A flag of git's own that takes no value.
      } else if (arg.startsWith("-")) {
        // An option this reader does not know: the reading where the next word is its value
        // waits its turn; this one goes on as if it takes none.
        if (!attached && index + 1 < args.length && started < MAX_READINGS) {
          started++;
          readings.push({
            config: new Map(config),
            dirs: [...dirs],
            gitDir,
            index: index + 2,
            workTree,
          });
        }
      } else {
        calls.push({ config, dirs, gitDir, rest: args.slice(index + 1), sub: arg, workTree });
        break;
      }
    }
  }
  return calls;
}
