/**
 * The arguments of a `worker` command, read one way: `--name value` and `--name=value` for an
 * option, `--name` alone for a flag, each name at most once, and only the names the command
 * knows. Everything else is a positional.
 *
 * One home for it, so every `worker` subcommand refuses an unknown option, a repeated one and a
 * missing value in the same words, and reads a comma list the same way (`commaList`).
 */

/** What was read: the valued options, the flags that were given, the positionals; or the mistake. */
export type Parsed =
  | { error: string }
  | { flags: Set<string>; options: Map<string, string>; positionals: string[] };

/**
 * Reads `argv`. `known` are the options that take a value, `flagNames` the ones that take none
 * (`--all`). A name in neither is a mistake, and so is a name given twice.
 */
export function parseOptions(
  argv: readonly string[],
  known: readonly string[],
  flagNames: readonly string[] = [],
): Parsed {
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    index += 1;
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
    if (options.has(name)) return { error: `${name} is given twice` };
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
    options.set(name, value);
  }
  return { flags, options, positionals };
}

/** A comma list: each part trimmed, empty ones dropped. */
export function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
