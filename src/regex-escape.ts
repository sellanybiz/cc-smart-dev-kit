/**
 * Text taken literally inside a regular expression: a dot is a dot, not any character. The one
 * home of that escape, for every part of the plugin. It lives at the top of `src/`, beside
 * `path-compare.ts`, because the hooks, setup and the issue screen all build patterns from text
 * they did not write (a folder name, a command).
 */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
