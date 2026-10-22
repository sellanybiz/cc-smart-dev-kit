/**
 * `diffAgainstBase`: git's own numstat, one record per changed file. A binary file is a
 * changed file with no line counts (null), never a file that changed no line.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { DiffError, diffAgainstBase } from "./diff";

/** A repo whose base commit holds four files, and whose HEAD changes all four. */
function world(): { base: string; env: Record<string, string>; repo: string } {
  const repo = tempDir("diff-repo");
  const env = cleanGitEnv();
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.txt"), "one\n");
  writeFileSync(join(repo, "src", "b.bin"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(repo, "src", "c.txt"), "gone\n");
  writeFileSync(join(repo, "src", "d e.txt"), "keep\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD").trim();
  // a.txt grows by two lines, b.bin changes, c.txt is deleted, d e.txt keeps its lines.
  writeFileSync(join(repo, "src", "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(repo, "src", "b.bin"), Buffer.from([0, 9, 8, 7]));
  rmSync(join(repo, "src", "c.txt"));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
  return { base, env, repo };
}

describe("diffAgainstBase", () => {
  test("each changed file's own counts, and a binary file's null ones", () => {
    const { base, env, repo } = world();
    expect(diffAgainstBase(repo, base, env)).toEqual({
      byFile: [
        { added: 2, deleted: 0, path: "src/a.txt" },
        { added: null, deleted: null, path: "src/b.bin" },
        { added: 0, deleted: 1, path: "src/c.txt" },
      ],
      deletions: 1,
      files: 3,
      insertions: 2,
      paths: ["src/a.txt", "src/b.bin", "src/c.txt"],
    });
  });

  test("a path with a space stays one record, and is named whole", () => {
    const { base, env, repo } = world();
    // The base's `d e.txt` is unchanged in HEAD: the space matters only to the reader's split.
    writeFileSync(join(repo, "src", "d e.txt"), "keep\nmore\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "touch the spaced file");
    const facts = diffAgainstBase(repo, base, env);
    expect(facts.byFile).toContainEqual({ added: 1, deleted: 0, path: "src/d e.txt" });
    expect(facts.files).toBe(4);
  });

  test("a base that is not in the repo is an error, never an empty diff", () => {
    const { env, repo } = world();
    expect(() => diffAgainstBase(repo, "0".repeat(40), env)).toThrow(DiffError);
  });
});
