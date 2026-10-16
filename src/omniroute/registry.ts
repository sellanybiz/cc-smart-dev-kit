/**
 * The newest OmniRoute release a machine may install: the npm registry's own list, with a
 * release at least three days old.
 *
 * Why three days: a release that reaches a machine the hour it is published reaches it
 * before anyone else has run it. OmniRoute is the model path of every Claude session on the
 * machine, so the same reasoning as a plugin release applies — a broken one takes the
 * machine's subagents down. Three days lets a bad release be yanked or superseded first.
 *
 * The registry is read as JSON (`https://registry.npmjs.org/<name>`): `versions` names every
 * published version, and `time` says when each was published. The pure part is separated so
 * a test feeds it a recorded answer.
 */

import { messageOf } from "../gateway/config";
import type { HealthFetch } from "../gateway/health";

/** The registry address; `https://registry.npmjs.org/<name>`. */
export const REGISTRY = "https://registry.npmjs.org";

/** A release counts as old enough this long after it was published. */
export const MIN_RELEASE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** A version and when it was published. */
export interface Release {
  version: string;
  /** ISO 8601, as the registry wrote it. */
  publishedAt: string;
}

/** A version number with no pre-release tag: `3.8.51`, not `3.9.0-canary.1`. */
const STABLE = /^\d+\.\d+\.\d+$/;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when npm's own entry for a version carries a deprecation note (`npm deprecate`). */
function isDeprecated(entry: unknown): boolean {
  return isJsonObject(entry) && typeof entry.deprecated === "string";
}

/**
 * Every stable release at least `MIN_RELEASE_AGE_MS` old, oldest first. A version with no
 * time in the registry, a pre-release, a version that is not a plain `x.y.z`, and a version
 * the package's own author deprecated (npm's `deprecated` note, which every install prints
 * as a warning) are left out: none of them is a release to move a machine to.
 */
export function parseReleases(text: string, nowMs: number): Release[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const body = raw as { time?: unknown; versions?: unknown };
  if (typeof body.versions !== "object" || body.versions === null) return [];
  if (typeof body.time !== "object" || body.time === null) return [];
  const times = body.time as Record<string, unknown>;
  const versions = body.versions as Record<string, unknown>;
  const releases: Release[] = [];
  for (const version of Object.keys(versions)) {
    if (!STABLE.test(version)) continue;
    if (isDeprecated(versions[version])) continue;
    const publishedAt = times[version];
    if (typeof publishedAt !== "string") continue;
    const at = Date.parse(publishedAt);
    if (Number.isNaN(at) || nowMs - at < MIN_RELEASE_AGE_MS) continue;
    releases.push({ publishedAt, version });
  }
  return releases.sort((a, b) => Bun.semver.order(a.version, b.version));
}

/** The part of `fetch` this needs: the one injectable type (`../gateway/health`). */
export type RegistryFetch = HealthFetch;

/**
 * The newest release a machine may install. `{ error }` in words when the registry cannot be
 * read: never a guessed version, and never a failure of the command that asked.
 */
export async function newestRelease(
  name: string,
  nowMs: number,
  fetchImpl: RegistryFetch,
  timeoutMs = 15_000,
): Promise<{ error: string } | { releases: Release[]; version: string }> {
  const url = `${REGISTRY}/${encodeURIComponent(name)}`;
  let text: string;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { error: `${url} answered HTTP ${response.status}` };
    }
    text = await response.text();
  } catch (error) {
    return { error: `${url}: ${messageOf(error)}` };
  }
  const releases = parseReleases(text, nowMs);
  const newest = releases.at(-1);
  return newest === undefined
    ? { error: `${url} lists no release at least ${MIN_RELEASE_AGE_MS / 86_400_000} days old` }
    : { releases, version: newest.version };
}

/** True when `installed` is older than `available`; an unreadable version counts as older. */
export function releaseIsNewer(installed: string, available: string): boolean {
  try {
    return Bun.semver.order(installed, available) < 0;
  } catch {
    return true;
  }
}
