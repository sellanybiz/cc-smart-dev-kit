/**
 * Fails when a pull request changes anything under plugin/ but keeps the plugin version.
 * Claude Code updates a plugin only when its version changes, so such a change would never
 * reach the machines that have the plugin installed.
 *
 *   bun scripts/check-version-bump.ts <base ref>     e.g. origin/main
 *
 * It compares HEAD with the point where it left <base ref> (git's base...HEAD), so commits
 * that landed on the base later do not count as this branch's changes. The new version must be
 * a strict semver version (semver.org: MAJOR.MINOR.PATCH, no `v`, no space, no leading zero),
 * and higher than the one at that point AND than the base's own version now: two pull requests
 * that raise to the same number both passed before, and the second would ship nothing new
 * (ST-9). A rollback is a new version with the old behaviour, never a lower number.
 *
 * "The base now" is the base ref as this checkout knows it, so CI must check a branch against
 * the base it merges into: a run that is older than the last merge proves nothing about it.
 */

export const PLUGIN_DIR = "plugin";
export const MANIFEST = "plugin/.claude-plugin/plugin.json";

/** A strict semver 2.0.0 version, the pattern semver.org gives. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** True when `text` is a strict semver version. */
export function isVersion(text: string): boolean {
  return SEMVER.test(text);
}

/** The base ref's short name for a message: `origin/main` → `main`. */
function baseName(baseRef: string): string {
  return baseRef.replace(/^(?:refs\/remotes\/)?origin\//, "");
}

export interface VersionBumpResult {
  ok: boolean;
  message: string;
}

interface GitOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
}

function git(
  options: GitOptions,
  ...args: string[]
): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** The plugin version in the manifest at `ref`, or null when the manifest is not there. */
function versionAt(options: GitOptions, ref: string): string | null {
  const show = git(options, "show", `${ref}:${MANIFEST}`);
  if (!show.ok) return null;
  const version = (JSON.parse(show.stdout) as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`${MANIFEST} at ${ref} has no version`);
  return version;
}

export function checkVersionBump(baseRef: string, options: GitOptions): VersionBumpResult {
  const mergeBase = git(options, "merge-base", baseRef, "HEAD");
  if (!mergeBase.ok) {
    throw new Error(
      `cannot find where HEAD left ${baseRef}: ${mergeBase.stderr.trim()} ` +
        "(in CI, check out with enough history: fetch-depth 0)",
    );
  }
  const base = mergeBase.stdout.trim();
  const diff = git(options, "diff", "--name-only", base, "HEAD", "--", PLUGIN_DIR);
  if (!diff.ok) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  const changed = diff.stdout.split("\n").filter((line) => line !== "");
  if (changed.length === 0) return { ok: true, message: "Nothing under plugin/ changed." };

  const before = versionAt(options, base);
  const after = versionAt(options, "HEAD");
  if (after === null) return { ok: false, message: `${MANIFEST} is missing.` };
  if (!isVersion(after)) {
    return {
      ok: false,
      message: `${MANIFEST}: ${JSON.stringify(after)} is not a version (MAJOR.MINOR.PATCH, as semver.org writes it).`,
    };
  }
  if (before === null) {
    return { ok: true, message: `${MANIFEST} is new (version ${after}).` };
  }
  const list = changed.map((file) => `  ${file}`).join("\n");
  if (before === after) {
    return {
      ok: false,
      message:
        `These files under plugin/ changed, but the version is still ${after}:\n${list}\n` +
        `Raise "version" in ${MANIFEST} (the release skill), then run: bun run build`,
    };
  }
  // `before` was checked by the run that let it in; one that is not a version (an old manifest)
  // cannot be compared, and the check says so rather than passing.
  if (!isVersion(before)) {
    return {
      ok: false,
      message: `${MANIFEST} at ${base}: ${JSON.stringify(before)} is not a version, so the raise cannot be checked.`,
    };
  }
  const order = Bun.semver.order(after, before);
  if (order < 0) {
    return {
      ok: false,
      message: `The version went down, ${before} -> ${after}. A rollback needs a higher version.`,
    };
  }
  if (order === 0) {
    // Only build metadata differs (`1.0.0+1`): the same version to Claude Code's update check.
    return {
      ok: false,
      message: `The version did not go up, ${before} -> ${after}: build metadata (after "+") does not make a version higher.`,
    };
  }
  // The base's own version now: another pull request may have raised it since this branch left.
  const tip = versionAt(options, baseRef);
  if (tip !== null && tip !== before && isVersion(tip) && Bun.semver.order(after, tip) <= 0) {
    return {
      ok: false,
      message:
        `${baseName(baseRef)} is at ${tip} now, and this branch has ${after}: another pull request raised it first. ` +
        `Raise "version" in ${MANIFEST} above ${tip} (the release skill), then run: bun run build`,
    };
  }
  const now = tip !== null && tip !== before ? ` (${baseName(baseRef)} is at ${tip})` : "";
  return {
    ok: true,
    message: `plugin/ changed, and the version went up: ${before} -> ${after}${now}.`,
  };
}

if (import.meta.main) {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error("Usage: bun scripts/check-version-bump.ts <base ref>   (e.g. origin/main)");
    process.exit(2);
  }
  try {
    const result = checkVersionBump(baseRef, { cwd: process.cwd() });
    (result.ok ? console.log : console.error)(result.message);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
