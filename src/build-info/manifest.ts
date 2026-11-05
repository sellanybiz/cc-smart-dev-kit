import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BuildInfo {
  /** The plugin version, from plugin.json. */
  version: string;
  /** The marketplace source as `<owner>/<name>`, from plugin.json's `repository`. */
  repo: string;
  /** The companion plugins from plugin.json's `dependencies`, each with its marketplace. */
  dependencies: Dependency[];
}

/** One entry of plugin.json's `dependencies`, in the object form this plugin uses. */
export interface Dependency {
  name: string;
  /** The marketplace it comes from. */
  marketplace: string;
  /** A semver range, when the dependency has one. */
  version?: string;
}

function readDependencies(manifestFile: string, raw: unknown): Dependency[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${manifestFile}: "dependencies" is not a list`);
  return raw.map((entry, index) => {
    const where = `${manifestFile}: dependencies[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${where}: write it as { "name", "marketplace" }`);
    }
    const { name, marketplace, version } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof marketplace !== "string") {
      throw new Error(`${where}: needs a "name" and a "marketplace"`);
    }
    if (version !== undefined && typeof version !== "string") {
      throw new Error(`${where}: "version" is not a string`);
    }
    return { name, marketplace, ...(version !== undefined && { version }) };
  });
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
    dependencies?: unknown;
  };
  if (typeof manifest.version !== "string") throw new Error(`${manifestFile}: no "version"`);
  if (typeof manifest.repository !== "string") throw new Error(`${manifestFile}: no "repository"`);
  return {
    version: manifest.version,
    repo: parseRepository(manifest.repository),
    dependencies: readDependencies(manifestFile, manifest.dependencies),
  };
}

/**
 * Only the `dependencies` of a plugin.json: what another copy of the plugin (the version in
 * the marketplace copy, before it is installed) needs. Throws when the file cannot be read or
 * its `dependencies` are not in the object form.
 */
export function readManifestDependencies(manifestFile: string): Dependency[] {
  const manifest: unknown = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error(`${manifestFile}: not a JSON object`);
  }
  return readDependencies(manifestFile, (manifest as { dependencies?: unknown }).dependencies);
}

/**
 * A Bun macro (imported `with { type: "macro" }`): it runs when the code is transpiled,
 * so the bundle holds only these values, never the rest of plugin.json.
 */
export function buildInfo(): BuildInfo {
  return readBuildInfo(
    join(import.meta.dir, "..", "..", "plugin", ".claude-plugin", "plugin.json"),
  );
}
