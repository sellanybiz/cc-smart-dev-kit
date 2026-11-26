/**
 * Whether a checkout compares paths without case, and which shared paths the base marks
 * generated: from `origin/<base>`'s own `.gitattributes` alone, a folder read as the files it
 * holds there, and nothing when the base or git cannot say, so the warning is then plain.
 */
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitConfig, makeClone, makeRepo } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { ignoresCase, planFilesCheck, warnOverlaps } from "./files-check";
import { openWorkDb, workDbFile } from "./work/db";
import { notesOf } from "./work/queries";
import { createTask, type PlanOverlap, reservePlan } from "./work/store";
import type { Result, Who } from "./work/types";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

test("core.ignorecase decides, and a setting git cannot read compares with case", () => {
  const repo = tempDir("ignorecase");
  git(repo, "init", "-q");
  git(repo, "config", "core.ignorecase", "true");
  expect(ignoresCase(repo, cleanGitEnv())).toBe(true);
  git(repo, "config", "core.ignorecase", "false");
  expect(ignoresCase(repo, cleanGitEnv())).toBe(false);
  expect(ignoresCase(tempDir("not-git"), cleanGitEnv())).toBe(false);
});

/** A clone whose origin/main holds `files`, and `attributes` as its `.gitattributes` when given. */
function based(files: string[], attributes?: string): string {
  const { repo } = makeClone();
  for (const file of files) {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), "export {};\n");
  }
  if (attributes !== undefined) writeFileSync(join(repo, ".gitattributes"), attributes);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "the base");
  commitConfig(repo, { workflow: { plans: { mergeFiles: [] } } }, ["main"]);
  return repo;
}
const FILES = ["db/types.gen.ts", "db/deep/client.gen.ts", "db/schema.ts", "src/a.ts"];

/** Which of `paths` the checkout's real check reads as generated on its base. */
function marked(repo: string, paths: string[], env = cleanGitEnv()) {
  const check = planFilesCheck(repo, env);
  if (check.generated === undefined) throw new Error("no generated reader");
  return check.generated(paths);
}

test("the base's marks name the generated files, and a folder entry names the files it holds", () => {
  const repo = based(FILES, "db/**/*.gen.ts linguist-generated\n");
  expect(marked(repo, ["db/", "src/a.ts"])).toEqual({
    ref: "origin/main",
    files: ["db/deep/client.gen.ts", "db/types.gen.ts"],
  });
  expect(marked(repo, ["db/types.gen.ts", "db/schema.ts"])).toEqual({
    ref: "origin/main",
    files: ["db/types.gen.ts"],
  });
  // A broad mark on the base names every shared file as it is.
  const broad = based(FILES, "* linguist-generated\n");
  expect(marked(broad, ["src/", "db/schema.ts"])?.files).toEqual(["db/schema.ts", "src/a.ts"]);
});

test("no .gitattributes on the base, a mark only on the branch, or a local attribute file names none", () => {
  const repo = based(FILES);
  expect(marked(repo, ["db/", "src/a.ts"])).toEqual({ ref: "origin/main", files: [] });
  // Marks a session could write without the base: a branch commit, info/attributes, the personal file.
  writeFileSync(join(repo, ".gitattributes"), "* linguist-generated\n");
  git(repo, "add", ".gitattributes");
  git(repo, "commit", "-q", "-m", "a branch mark");
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
  writeFileSync(join(repo, ".git", "info", "attributes"), "* linguist-generated\n");
  const personal = join(tempDir("personal"), "attributes");
  writeFileSync(personal, "* linguist-generated\n");
  git(repo, "config", "core.attributesFile", personal);
  expect(marked(repo, ["db/", "src/a.ts"])).toEqual({ ref: "origin/main", files: [] });
});

/** The environment with a `git` first on PATH that refuses `--source`, as git before 2.40 does. */
function withoutSource(env: Record<string, string>): Record<string, string> {
  const dir = tempDir("old-git");
  const real = Bun.which("git") ?? "/usr/bin/git";
  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh\nfor arg in "$@"; do case "$arg" in --source=*) echo "error: unknown option '$arg'" >&2; exit 129;; esac; done\nexec "${real}" "$@"\n`,
  );
  chmodSync(join(dir, "git"), 0o755);
  return { ...env, PATH: `${dir}:${env.PATH ?? ""}` };
}

test("an old git, or no base ref, cannot say: the reader answers null and the warning is plain", () => {
  const repo = based(FILES, "db/**/*.gen.ts linguist-generated\n");
  const old = withoutSource(cleanGitEnv());
  expect(marked(repo, ["db/"], old)).toBeNull();
  expect(marked(makeRepo(), ["db/"])).toBeNull();
  // Outside git there is no base at all, so no reader.
  expect(planFilesCheck(tempDir("not-git"), cleanGitEnv()).generated).toBeUndefined();
  // The warning over an old git's check: the overlap, with no generated file and no propose line.
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  try {
    for (const slug of ["alpha", "beta"])
      ok(
        createTask(
          db,
          { project: "p", subject: slug, kind: "plan", plan: slug, files: ["db/types.gen.ts"] },
          LEAD,
          1,
        ),
      );
    const reserve = (slug: string, found?: PlanOverlap[]) =>
      ok(
        reservePlan(db, {
          project: "p",
          plan: slug,
          who: LEAD,
          holder: "child",
          ignore: [],
          caseFold: false,
          ...(found === undefined ? {} : { found }),
          now: 2,
        }),
      );
    reserve("alpha");
    const found: PlanOverlap[] = [];
    const beta = reserve("beta", found);
    const lines = warnOverlaps(db, found, planFilesCheck(repo, old), LEAD, 3);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith('Overlap: #1 "alpha" and #2 "beta" share db/types.gen.ts.');
    expect(lines[0]).not.toContain("generated");
    expect(lines[0]).not.toContain("workflow propose");
    expect(notesOf(db, beta.id).map((note) => note.text)).toEqual(lines);
  } finally {
    db.close();
  }
});
