/**
 * The portal app's API types stay one mirror of the server's (`wire-mirror.ts` says how).
 *
 * Three checks, each of which fails on its own kind of drift:
 *   - every name `types.ts` exports is checked in `MIRRORED` (or listed, with its reason, in
 *     `SERVER_ONLY`), and `portal/src/api/wire.ts` exports it — a new server type cannot be
 *     forgotten;
 *   - the type checker passes `wire-mirror.ts` on its own — a changed field is a type error;
 *   - the app's list of actions is the server's own list, in the same order.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACTION_NAMES as APP_ACTIONS } from "../../../portal/src/api/wire";
import { ACTION_NAMES } from "../actions";
import { MIRRORED, SERVER_ONLY } from "./wire-mirror";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SERVER_TYPES = join(import.meta.dir, "types.ts");
const WIRE = join(ROOT, "portal", "src", "api", "wire.ts");

/**
 * The project's `tsc`: in `node_modules/.bin` of this folder, or of the nearest folder above it
 * that has one. A session works in a git worktree under `.claude/worktrees/`, which has no
 * `node_modules` of its own; bun's own `run` finds the checkout's, and this does the same.
 */
function tscBinary(): string {
  for (let dir = ROOT; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", ".bin", "tsc");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return join(ROOT, "node_modules", ".bin", "tsc");
  }
}

/** The type names a file exports: its own declarations and its `export type { … }` lists. */
function exportedTypes(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)/gm)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  for (const block of text.matchAll(/^export type \{([^}]*)\}/gm)) {
    for (const name of (block[1] ?? "").split(",")) {
      const trimmed = name.trim();
      if (trimmed !== "") names.add(trimmed);
    }
  }
  return [...names].sort();
}

describe("the portal app's API types mirror the server's", () => {
  test("every exported server type is checked, and the app's file exports it", () => {
    const server = exportedTypes(readFileSync(SERVER_TYPES, "utf8"));
    // The parse itself, against a few names written by hand: an empty list would pass anything.
    expect(server).toContain("SlotsAnswer");
    expect(server).toContain("LiveEvents");
    expect(server).toContain("HistoryAnswer");
    const checked = [...Object.keys(MIRRORED), ...Object.keys(SERVER_ONLY)].sort();
    expect(checked).toEqual(server);
    const wire = new Set(exportedTypes(readFileSync(WIRE, "utf8")));
    expect(Object.keys(MIRRORED).filter((name) => !wire.has(name))).toEqual([]);
  });

  test("the type checker passes the mirror on its own", () => {
    // The root's own options, on the one file (and what it imports): a drifted field is a
    // type error on that name's line. The repo's `tsc` (the version `bun run typecheck` runs).
    const run = Bun.spawnSync(
      [
        tscBinary(),
        "--noEmit",
        "--ignoreConfig",
        "--strict",
        "--noUncheckedIndexedAccess",
        "--exactOptionalPropertyTypes",
        "--verbatimModuleSyntax",
        "--isolatedModules",
        "--skipLibCheck",
        "--resolveJsonModule",
        "--target",
        "ESNext",
        "--module",
        "Preserve",
        "--moduleResolution",
        "bundler",
        "--lib",
        "ESNext",
        "--types",
        "bun",
        join(import.meta.dir, "wire-mirror.ts"),
      ],
      { cwd: ROOT, stderr: "pipe", stdout: "pipe" },
    );
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    expect(output).toBe("");
    expect(run.exitCode).toBe(0);
  }, 120_000);

  test("the app's actions are the server's, in the same order", () => {
    expect([...APP_ACTIONS]).toEqual([...ACTION_NAMES]);
  });
});
