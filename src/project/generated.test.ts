/**
 * Which files a commit marks generated, read from that commit alone: each local attribute file
 * a checkout may hold is written with a mark on every file, and the answer must not change.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "../hooks/git";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { generatedChecks, generatedIn, openBaseOnlyGit } from "./generated";

/** Every file the cases ask about: two the base marks, one it unmarks, one it says nothing of. */
const PATHS = ["dist/app.js", "lib/made.js", "lib/kept.js", "src/main.js"];

/** What the base marks generated. */
const BASE_MARKED = ["dist/app.js", "lib/made.js"];

/** A mark on every file, as a local attribute file would hold it. */
const EVERYTHING = "* linguist-generated\n";

/**
 * What a plain read gives under a personal attributes file's `EVERYTHING`: below the tree's own
 * files in precedence (gitattributes(5)), it cannot undo the base's unmark, only add marks.
 */
const WIDENED = ["dist/app.js", "lib/made.js", "src/main.js"];

/** A repository whose one commit on `main` marks `BASE_MARKED`; its id. */
function baseRepo(objectFormat = "sha1"): { repo: string; base: string } {
  const repo = tempDir("generated");
  git(repo, "init", "-q", "-b", "main", `--object-format=${objectFormat}`);
  writeFileSync(
    join(repo, ".gitattributes"),
    "dist/** linguist-generated=true\nlib/made.js linguist-generated\nlib/kept.js -linguist-generated\n",
  );
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "main.js"), "main\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return { repo, base: git(repo, "rev-parse", "HEAD").trim() };
}

/** The paths of `PATHS` that `base` marks generated, read the way the home says to. */
function generated(repo: string, base: string, env = cleanGitEnv()): string[] {
  const isolated = openBaseOnlyGit(join(repo, ".git"), base);
  try {
    return generatedChecks(base, PATHS).flatMap((args) => {
      const run = runGit(repo, args, env, 15_000, isolated.env);
      if (!run.ok) throw new Error(run.err);
      return generatedIn(run.out);
    });
  } finally {
    isolated.remove();
  }
}

/** The same question asked of git plainly, as review-cover asked it before: what a mark reaches. */
function plainly(repo: string, base: string, env = cleanGitEnv()): string[] {
  const run = runGit(
    repo,
    ["check-attr", `--source=${base}`, "-z", "linguist-generated", "--", ...PATHS],
    env,
  );
  if (!run.ok) throw new Error(run.err);
  return generatedIn(run.out);
}

describe("the base's own marks", () => {
  test("set and true count; unset and unspecified do not", () => {
    const { repo, base } = baseRepo();
    expect(generated(repo, base)).toEqual(BASE_MARKED);
  });

  test("a sha-256 repository is read too", () => {
    const { repo, base } = baseRepo("sha256");
    expect(base).toHaveLength(64);
    expect(generated(repo, base)).toEqual(BASE_MARKED);
  });
});

describe("security: no local attribute file widens the base's marks", () => {
  test("the repository's info/attributes", () => {
    const { repo, base } = baseRepo();
    writeFileSync(join(repo, ".git", "info", "attributes"), EVERYTHING);
    expect(plainly(repo, base)).toEqual(PATHS);
    expect(generated(repo, base)).toEqual(BASE_MARKED);
  });

  test("a core.attributesFile in the repository's config, and in the person's", () => {
    const { repo, base } = baseRepo();
    const file = join(tempDir("attributes"), "attributes");
    writeFileSync(file, EVERYTHING);
    git(repo, "config", "core.attributesFile", file);
    expect(plainly(repo, base)).toEqual(WIDENED);
    expect(generated(repo, base)).toEqual(BASE_MARKED);

    git(repo, "config", "--unset", "core.attributesFile");
    const global = join(tempDir("gitconfig"), "gitconfig");
    writeFileSync(global, `[core]\n\tattributesFile = ${file}\n`);
    const env = { ...cleanGitEnv(), GIT_CONFIG_GLOBAL: global };
    expect(plainly(repo, base, env)).toEqual(WIDENED);
    expect(generated(repo, base, env)).toEqual(BASE_MARKED);
  });

  test("the default personal file, $XDG_CONFIG_HOME/git/attributes", () => {
    const { repo, base } = baseRepo();
    const config = tempDir("xdg");
    mkdirSync(join(config, "git"));
    writeFileSync(join(config, "git", "attributes"), EVERYTHING);
    const env = { ...cleanGitEnv(), XDG_CONFIG_HOME: config };
    expect(plainly(repo, base, env)).toEqual(WIDENED);
    expect(generated(repo, base, env)).toEqual(BASE_MARKED);
  });

  test("a mark only on the branch, committed or in the working tree", () => {
    const { repo, base } = baseRepo();
    git(repo, "checkout", "-q", "-b", "feat");
    writeFileSync(join(repo, ".gitattributes"), EVERYTHING);
    git(repo, "commit", "-q", "-am", "mark everything");
    mkdirSync(join(repo, "lib"));
    writeFileSync(join(repo, "lib", ".gitattributes"), EVERYTHING);
    expect(generated(repo, base)).toEqual(BASE_MARKED);
  });
});

describe("the parts", () => {
  test("generatedChecks: one call per 200 paths, the local files switched off", () => {
    const paths = Array.from({ length: 450 }, (_, index) => `f${index}`);
    const checks = generatedChecks("a".repeat(40), paths);
    expect(checks.map((args) => args.length - 7)).toEqual([200, 200, 50]);
    expect(checks[0]?.slice(0, 8)).toEqual([
      "-c",
      "core.attributesFile=",
      "check-attr",
      `--source=${"a".repeat(40)}`,
      "-z",
      "linguist-generated",
      "--",
      "f0",
    ]);
    expect(checks[2]?.at(-1)).toBe("f449");
    expect(generatedChecks("a".repeat(40), [])).toEqual([]);
  });

  test("generatedIn reads the -z triples: set and true only", () => {
    const out = [
      ["a.js", "linguist-generated", "set"],
      ["b.js", "linguist-generated", "unspecified"],
      ["c d.js", "linguist-generated", "true"],
      ["e.js", "linguist-generated", "false"],
      ["f.js", "linguist-generated", "unset"],
    ]
      .map((triple) => `${triple.join("\0")}\0`)
      .join("");
    expect(generatedIn(out)).toEqual(["a.js", "c d.js"]);
    expect(generatedIn("")).toEqual([]);
  });

  test("the throwaway folder is gone after remove", () => {
    const { repo, base } = baseRepo();
    const isolated = openBaseOnlyGit(join(repo, ".git"), base);
    const folder = isolated.env.GIT_DIR ?? "";
    expect(existsSync(join(folder, "objects", "info", "alternates"))).toBe(true);
    isolated.remove();
    expect(existsSync(folder)).toBe(false);
  });
});
