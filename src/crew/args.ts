/**
 * The arguments of a `crew` command, read one way: `--name value` and `--name=value` for an
 * option, `--name` alone for a flag, only the names the command knows, and everything else is a
 * positional.
 *
 * One home for it, so every `crew` subcommand refuses an unknown option, a repeated one and a
 * missing value in the same words, and reads a comma list the same way (`commaList`).
 *
 * Each option is given at most once, except the names a command lists as `repeatable` (`--option`
 * in a question): their values collect in `lists`, in the order they were given.
 */

/** What was read: the options, the flags that were given, the positionals. */
export interface ParsedOptions {
  /** Each option's value, for the options given once. */
  options: Map<string, string>;
  /** Each repeatable option's values, in the order given. */
  lists: Map<string, string[]>;
  /** The flags that were given (the names that take no value). */
  flags: Set<string>;
  /** The arguments that are not options. */
  positionals: string[];
}

/** What was read, or the mistake. */
export type Parsed = { error: string } | ParsedOptions;

/**
 * Reads `argv`. `known` are the options that take a value, `flagNames` the ones that take none
 * (`--all`), `repeatable` the options (also listed in `known`) that may be given more than once.
 * A name in none of them is a mistake, and so is a name given twice. A bare `--` ends the
 * options: what follows is positional, so an answer that starts with `--` can still be given.
 */
export function parseOptions(
  argv: readonly string[],
  known: readonly string[],
  flagNames: readonly string[] = [],
  repeatable: readonly string[] = [],
): Parsed {
  const options = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    index += 1;
    if (arg === "--") {
      positionals.push(...argv.slice(index));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (flagNames.includes(name)) {
      if (equals !== -1) return { error: `${name} takes no value` };
      if (flags.has(name)) return { error: `${name} is given twice` };
      flags.add(name);
      continue;
    }
    if (!known.includes(name)) return { error: `Unknown option: ${arg}` };
    let value: string | undefined;
    if (equals === -1) {
      value = argv[index];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === "" || (equals === -1 && value.startsWith("--"))) {
      return { error: `${name} needs a value` };
    }
    if (repeatable.includes(name)) {
      const values = lists.get(name) ?? [];
      values.push(value);
      lists.set(name, values);
      continue;
    }
    if (options.has(name)) return { error: `${name} is given twice` };
    options.set(name, value);
  }
  return { flags, lists, options, positionals };
}

/** A comma list: each part trimmed, empty ones dropped. */
export function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
