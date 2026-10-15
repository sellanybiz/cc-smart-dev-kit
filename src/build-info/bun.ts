// The oldest Bun anymodel runs on, with no build-time macro: the router bundle imports this
// too, and it must not carry the plugin version (`./names` says why).

/**
 * The oldest Bun anymodel runs on. 1.4.3 is the first whose `fetch` honours
 * `proxy: false` (oven-sh/bun#42692): a request to a backend on this machine carries the
 * backend's key, and an older Bun sends it through HTTP_PROXY all the same.
 * `package.json` `engines.bun` and CI's Bun follow this number.
 */
export const MIN_BUN = "1.4.3";

/**
 * "anymodel needs Bun ≥ 1.4.3; this is 1.4.2 (/path/to/bun)." for a Bun older than
 * `MIN_BUN`, else null. `path` is that Bun's file. A pre-release of `MIN_BUN` itself
 * (`1.4.3-canary.1`) counts as older: it may have been built before the fix.
 */
export function bunTooOld(version: string, path: string): null | string {
  return Bun.semver.order(version, MIN_BUN) < 0
    ? `anymodel needs Bun ≥ ${MIN_BUN}; this is ${version} (${path}).`
    : null;
}
