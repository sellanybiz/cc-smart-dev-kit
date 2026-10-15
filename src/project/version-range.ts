/**
 * Version ranges for cc.json's `requires`, in npm's syntax (">=1.2", "^1.2", "~1.2.3",
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
