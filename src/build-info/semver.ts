/** True when `a` is lower than `b` as versions; a version that cannot be read counts as lower. */
export function isOlder(a: null | string, b: null | string): boolean {
  if (b === null) return false;
  if (a === null) return true;
  try {
    return Bun.semver.order(a, b) < 0;
  } catch {
    return false;
  }
}
