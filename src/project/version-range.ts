/**
 * Version ranges for cc-smart-dev-kit.json's `requires`, in npm's syntax (">=1.2", "^1.2", "~1.2.3",
 * "1.x", "1.2.0 - 2.0.0", ">=1.2 <2", "^1 || ^2").
 *
 * Matching uses Bun.semver (built into Bun, npm-compatible), so there is no extra dependency.
 * Bun.semver treats text it cannot read as "any version", so we check the syntax first:
 * a typo like ">=1.2a" must be an error, not a pass.
 */

const NUMBER = "(?:x|X|\\*|0|[1-9]\\d*)";
const IDENT = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const PARTIAL = `v?${NUMBER}(?:\\.${NUMBER}(?:\\.${NUMBER}(?:-${IDENT})?(?:\\+${IDENT})?)?)?`;
const COMPARATOR = new RegExp(`^(?:[<>]=?|=|\\^|~)?${PARTIAL}$`);
const HYPHEN = new RegExp(`^(${PARTIAL})\\s+-\\s+(${PARTIAL})$`);

/** True when `range` is a version range we can read. */
export function isValidRange(range: string): boolean {
  const alternatives = range.split("||").map((part) => part.trim());
  if (alternatives.some((part) => part === "")) return false;
  return alternatives.every((part) => {
    if (HYPHEN.test(part)) return true;
    // npm allows a space after the operator: ">= 1.2" means ">=1.2".
    const comparators = part.replace(/([<>]=?|=|\^|~)\s+/g, "$1").split(/\s+/);
    return comparators.every((comparator) => COMPARATOR.test(comparator));
  });
}

/** True when `version` is in `range`. Throws on a range we cannot read. */
export function satisfiesRange(version: string, range: string): boolean {
  if (!isValidRange(range)) throw new Error(`"${range}" is not a valid version range`);
  return Bun.semver.satisfies(version, range);
}

/** One alternative of a range: its first comparator and version (`>=1.1`, `^1.1`, `~1.1.0`, `1.1`). */
const RANGE_START = /^\s*(>=|>|\^|~|=|<=|<)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/**
 * The lowest plugin version a `requires` range lets in, or null when the range's form is not
 * one read here. Each `||` alternative is read by its first comparator: `>=`, `>`, `^`, `~`, `=`
 * or a bare version start at the version written; one that starts with `<` lets in 0.0.0. So
 * `~1.1.0`, `^1.1` and `>=1.1 <2` all start at 1.1.0. `project init` reads it to keep a range
 * that already starts high enough; the `requires` check reads it to tell a plugin too old for a
 * range from one past its top.
 */
export function lowestAllowed(range: string): null | string {
  let lowest: null | string = null;
  for (const part of range.split("||")) {
    const match = RANGE_START.exec(part);
    if (match === null) return null;
    const version = match[1]?.startsWith("<")
      ? "0.0.0"
      : `${match[2]}.${match[3] ?? "0"}.${match[4] ?? "0"}`;
    if (lowest === null || Bun.semver.order(version, lowest) < 0) lowest = version;
  }
  return lowest;
}
