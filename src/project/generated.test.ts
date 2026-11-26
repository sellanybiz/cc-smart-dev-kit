/**
 * Which files a commit marks generated, read from that commit alone: each local attribute file
 * a checkout may hold is written with a mark on every file, and the answer must not change.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "../hooks/git";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { generatedIn, openBaseOnlyGit, readGenerated } from "./generated";

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

/** The paths of `paths` that `base` marks generated, read through the home's one reader. */
function generated(repo: string, base: string, env = cleanGitEnv(), paths = PATHS): string[] {
  const marked = readGenerated(join(repo, ".git"), base, paths, env);
  if (marked === null) throw new Error("no answer");
  return paths.filter((path) => marked.has(path));
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

  test("a personal core.ignoreCase does not stretch a mark to a path of another case", () => {
    const { repo, base } = baseRepo();
    const global = join(tempDir("gitconfig"), "gitconfig");
    writeFileSync(global, "[core]\n\tignoreCase = true\n");
    const env = { ...cleanGitEnv(), GIT_CONFIG_GLOBAL: global };
    const run = runGit(
      repo,
      ["check-attr", `--source=${base}`, "-z", "linguist-generated", "--", "DIST/app.js"],
      env,
    );
    expect(generatedIn(run.out)).toEqual(["DIST/app.js"]);
    expect(generated(repo, base, env, ["DIST/app.js"])).toEqual([]);
  });

  test("GIT_ATTR_SOURCE, and attr.tree passed in the environment, point nowhere else", () => {
    const { repo, base } = baseRepo();
    git(repo, "checkout", "-q", "-b", "side");
    writeFileSync(join(repo, ".gitattributes"), EVERYTHING);
    git(repo, "commit", "-q", "-am", "mark everything");
    const side = git(repo, "rev-parse", "HEAD").trim();
    const source = { ...cleanGitEnv(), GIT_ATTR_SOURCE: side };
    expect(generated(repo, base, source)).toEqual(BASE_MARKED);
    const tree = {
      ...cleanGitEnv(),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "attr.tree",
      GIT_CONFIG_VALUE_0: side,
    };
    expect(generated(repo, base, tree)).toEqual(BASE_MARKED);
  });

  test("a replace ref on the source commit is not what is read", () => {
    const { repo, base } = baseRepo();
    git(repo, "checkout", "-q", "--orphan", "side");
    writeFileSync(join(repo, ".gitattributes"), EVERYTHING);
    git(repo, "add", ".gitattributes");
    git(repo, "commit", "-q", "-m", "side");
    const side = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "replace", base, side);
    expect(generated(repo, base)).toEqual(BASE_MARKED);
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
  test("checks: one call per 200 paths, the local files switched off", () => {
    const { repo, base } = baseRepo();
    const isolated = openBaseOnlyGit(join(repo, ".git"), base);
    try {
      const none = join(isolated.env.GIT_DIR ?? "", "none");
      const paths = Array.from({ length: 450 }, (_, index) => `f${index}`);
      const checks = isolated.checks(paths);
      expect(checks.map((args) => args.length - 9)).toEqual([200, 200, 50]);
      expect(checks[0]?.slice(0, 11)).toEqual([
        "-c",
        `core.attributesFile=${none}`,
        "-c",
        "core.ignoreCase=false",
        "check-attr",
        `--source=${base}`,
        "-z",
        "linguist-generated",
        "--",
        "f0",
        "f1",
      ]);
      expect(checks[2]?.at(-1)).toBe("f449");
      expect(isolated.checks([])).toEqual([]);
      expect(existsSync(none)).toBe(false);
    } finally {
      isolated.remove();
    }
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

  test("a first path that starts with a space keeps it, and its mark", () => {
    const repo = tempDir("generated-space");
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, ".gitattributes"), "*lead.js linguist-generated\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    const base = git(repo, "rev-parse", "HEAD").trim();
    expect(generated(repo, base, cleanGitEnv(), [" lead.js"])).toEqual([" lead.js"]);
  });

  test("readGenerated has no answer, and throws nothing, when git cannot run", () => {
    const { repo, base } = baseRepo();
    const env = { ...cleanGitEnv(), PATH: "/nonexistent" };
    expect(readGenerated(join(repo, ".git"), base, PATHS, env)).toBe(null);
  });

  test("readGenerated has no answer, and throws nothing, when no temp folder can be made", () => {
    const { repo, base } = baseRepo();
    const before = process.env.TMPDIR;
    process.env.TMPDIR = join(tempDir("tmp"), "missing");
    try {
      expect(readGenerated(join(repo, ".git"), base, PATHS, cleanGitEnv())).toBe(null);
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
  });

  test("readBase writes the commit's .gitattributes files into the work tree, and nothing else", () => {
    const { repo, base } = baseRepo();
    git(repo, "checkout", "-q", "-b", "nested");
    mkdirSync(join(repo, "lib"), { recursive: true });
    writeFileSync(join(repo, "lib", ".gitattributes"), "*.js text\n");
    writeFileSync(join(repo, "lib", "made.js"), "made\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "nested");
    const nested = git(repo, "rev-parse", "HEAD").trim();
    expect(nested).not.toBe(base);
    const isolated = openBaseOnlyGit(join(repo, ".git"), nested);
    try {
      const read = runGit(isolated.cwd, isolated.readBase, cleanGitEnv(), 15_000, isolated.env);
      expect(read).toMatchObject({ ok: true });
      expect(readdirSync(isolated.cwd, { recursive: true }).sort()).toEqual([
        ".gitattributes",
        "lib",
        join("lib", ".gitattributes"),
      ]);
    } finally {
      isolated.remove();
    }
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
