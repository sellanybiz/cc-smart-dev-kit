/**
 * The words of a caught error, whatever was thrown. It lives at the top of `src/`, beside
 * `path-compare.ts`, and imports nothing, so the hooks' frame can use it without loading
 * anything more.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
