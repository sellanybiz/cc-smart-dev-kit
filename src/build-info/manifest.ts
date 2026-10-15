import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BuildInfo {
  /** The plugin version, from plugin.json. */
  version: string;
  /** The marketplace source as `<owner>/<name>`, from plugin.json's `repository`. */
  repo: string;
}

/**
 * `<owner>/<name>` from a repository URL:
 * `https://host/owner/name(.git)`, `git@host:owner/name(.git)`, or `owner/name`.
 */
export function parseRepository(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const match =
    /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(trimmed) ?? // https://host/owner/name
    /^[^@\s]+@[^:\s]+:(.+)$/.exec(trimmed) ?? // git@host:owner/name
    /^([^/\s:]+\/[^/\s:]+)$/.exec(trimmed); // owner/name
  const path = match?.[1];
  const parts = path?.split("/") ?? [];
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    throw new Error(`Cannot read <owner>/<name> from the repository "${url}"`);
  }
  return parts.join("/");
}

/** Reads only what the CLI needs from a plugin.json. */
export function readBuildInfo(manifestFile: string): BuildInfo {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    version?: unknown;
    repository?: unknown;
  };
  if (typeof manifest.version !== "string") throw new Error(`${manifestFile}: no "version"`);
  if (typeof manifest.repository !== "string") throw new Error(`${manifestFile}: no "repository"`);
  return { version: manifest.version, repo: parseRepository(manifest.repository) };
}

/**
 * A Bun macro (imported `with { type: "macro" }`): it runs when the code is transpiled,
 * so the bundle holds only these two values, never the rest of plugin.json.
 */
export function buildInfo(): BuildInfo {
  return readBuildInfo(
    join(import.meta.dir, "..", "..", "plugin", ".claude-plugin", "plugin.json"),
  );
}
