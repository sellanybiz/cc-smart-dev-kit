/**
 * What a commit's own attributes say, and nothing else: which files it marks generated (the
 * `linguist-generated` attribute, set or `true`), and, for `git diff`, which files count as binary.
 *
 * The review count leaves generated files out and never covers a binary change
 * (`src/workflow/review-cover.ts`), so both must come from the base a pull request merges into,
 * never from the checkout that asks. git reads attributes from more places than the commit's
 * `.gitattributes` (gitattributes(5)): `$GIT_DIR/info/attributes`, the file `core.attributesFile`
 * names (by default `$XDG_CONFIG_HOME/git/attributes`) and the system file; the person's own config
 * can also say a diff driver is or is not binary, and `core.ignoreCase` stretches a pattern to
 * paths of another case. A session could set any of them without a commit. So each call runs in a
 * throwaway git folder (`openBaseOnlyGit`):
 *
 * - its own `GIT_DIR`, which borrows the repository's objects through `objects/info/alternates`,
 *   so the repository's own `info/attributes` and config are not read;
 * - a work tree of its own that holds only the commit's `.gitattributes` files (`readBase`), and
 *   every call runs in it (`cwd`): `git diff` reads `.gitattributes` from the folder it runs in
 *   (attr.c's `read_attr_from_file`, a path relative to it), so it reads the commit's own files
 *   and no checkout's;
 * - `-c core.attributesFile=<folder>/none`, a file that never exists, so no personal attributes
 *   file is read on any git version, and `-c core.ignoreCase=false`;
 * - `GIT_CONFIG_GLOBAL=<folder>/none` and `GIT_CONFIG_NOSYSTEM=1`, so no personal or system
 *   config is read (git(1); `GIT_CONFIG_GLOBAL` came in git 2.32);
 * - `GIT_ATTR_NOSYSTEM=1`, so the system attributes file is not read. No manual page lists this
 *   variable (git(1) and gitattributes(5) of git 2.53 checked); git's attr.c reads it
 *   (`git_attr_system_is_enabled`), and a test cannot write the system file.
 *
 * `check-attr --source` came in git 2.40: on an older git the call fails, and a caller takes a
 * failed call on the safe side (no file is generated, or no answer), never as a mark.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";

/** The attribute that marks a file generated: GitHub Linguist's name, which projects use. */
const GENERATED_ATTRIBUTE = "linguist-generated";

/** The values of `GENERATED_ATTRIBUTE` that mark a file generated, as `check-attr` prints them. */
const MARKED_VALUES: ReadonlySet<string> = new Set(["set", "true"]);

/** How many paths one `git check-attr` call names: well inside every system's argument limit. */
const PATHS_PER_CALL = 200;

/**
 * A commit id of 64 hex digits: only a repository that uses sha-256 has one. Its throwaway folder
 * must say so; git's default, sha-1 (40 digits), needs no config.
 */
const SHA256_ID = /^[0-9a-f]{64}$/;

/**
 * The paths one `check-attr -z` call's output (`path NUL attribute NUL value NUL`) marks.
 * Similar to `src/hooks/unsaved-changes.ts:filteredPaths`; not shared yet: that one asks other
 * attributes, keeps every value but unset and unspecified, and reads a checkout's own attributes
 * on purpose.
 */
export function generatedIn(out: string): string[] {
  const fields = out.split("\0");
  const generated: string[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index] ?? "";
    if (path !== "" && MARKED_VALUES.has(fields[index + 2] ?? "")) generated.push(path);
  }
  return generated;
}

/** A throwaway git folder that reads a repository's objects and one commit's attributes. */
export interface BaseOnlyGit {
  /** The folder each call runs in: the work tree, empty until `readBase`. */
  cwd: string;
  /** The variables each call sets, after `gitEnv` drops the inherited ones. */
  env: Record<string, string>;
  /** `command` as one call in the folder: the options that switch the local files off, first. */
  args(command: readonly string[]): string[];
  /**
   * The `check-attr` calls that ask which of `paths` the commit marks generated, one for each
   * batch of `PATHS_PER_CALL` paths (similar to `unsaved-changes.ts`'s `chunks`; not shared yet:
   * that one batches `hash-object`), none for no paths.
   */
  checks(paths: readonly string[]): string[][];
  /**
   * The call that writes the commit's `.gitattributes` files, and nothing else, into the work
   * tree: run it before a `git diff`. A sparse checkout (git-read-tree(1)) whose one pattern is
   * that name puts the whole tree in the folder's index and only those files on disk.
   */
  readBase: string[];
  /** Removes the folder. */
  remove(): void;
}

/**
 * A throwaway git folder for the repository whose common git folder is `commonDir`, made for
 * reading the attributes of commit `source`, a full commit id (the folder holds no refs; the id
 * also says whether the objects are sha-1 or sha-256). The caller removes it when its calls are
 * done. Throws when the temp folder cannot be written.
 */
export function openBaseOnlyGit(commonDir: string, source: string): BaseOnlyGit {
  const folder = mkdtempSync(join(tmpdir(), `${COMMAND}-attributes-`));
  const none = join(folder, "none");
  try {
    mkdirSync(join(folder, "refs"));
    mkdirSync(join(folder, "objects", "info"), { recursive: true });
    mkdirSync(join(folder, "info"));
    mkdirSync(join(folder, "tree"));
    writeFileSync(join(folder, "info", "sparse-checkout"), ".gitattributes\n");
    writeFileSync(join(folder, "HEAD"), "ref: refs/heads/none\n");
    writeFileSync(join(folder, "objects", "info", "alternates"), `${join(commonDir, "objects")}\n`);
    if (SHA256_ID.test(source)) {
      writeFileSync(
        join(folder, "config"),
        "[core]\n\trepositoryformatversion = 1\n[extensions]\n\tobjectFormat = sha256\n",
      );
    }
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  const args = (command: readonly string[]): string[] => [
    "-c",
    `core.attributesFile=${none}`,
    "-c",
    "core.ignoreCase=false",
    ...command,
  ];
  return {
    cwd: join(folder, "tree"),
    env: {
      GIT_DIR: folder,
      GIT_WORK_TREE: join(folder, "tree"),
      GIT_INDEX_FILE: join(folder, "index"),
      GIT_CONFIG_GLOBAL: none,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ATTR_NOSYSTEM: "1",
    },
    args,
    checks: (paths) => {
      const checks: string[][] = [];
      for (let at = 0; at < paths.length; at += PATHS_PER_CALL) {
        const batch = paths.slice(at, at + PATHS_PER_CALL);
        checks.push(
          args(["check-attr", `--source=${source}`, "-z", GENERATED_ATTRIBUTE, "--", ...batch]),
        );
      }
      return checks;
    },
    readBase: args([
      "-c",
      "core.sparseCheckout=true",
      "-c",
      "core.sparseCheckoutCone=false",
      "read-tree",
      "-m",
      "-u",
      source,
    ]),
    remove: () => rmSync(folder, { recursive: true, force: true }),
  };
}

/**
 * Which of `paths` commit `source` marks generated, for the repository whose common git folder
 * is `commonDir`, run synchronously. Null when there is no answer: git older than 2.40, a
 * source git cannot read, or a temp folder that cannot be written. It never throws: a caller
 * reads null as "nothing known to be generated". The throwaway folder is always removed.
 */
export function readGenerated(
  commonDir: string,
  source: string,
  paths: readonly string[],
  env: Env,
  timeoutMs?: number,
): Set<string> | null {
  if (paths.length === 0) return new Set();
  try {
    const isolated = openBaseOnlyGit(commonDir, source);
    try {
      const marked = new Set<string>();
      for (const args of isolated.checks(paths)) {
        const run = runGit(isolated.cwd, args, env, timeoutMs, isolated.env);
        if (!run.ok) return null;
        for (const path of generatedIn(run.out)) marked.add(path);
      }
      return marked;
    } finally {
      isolated.remove();
    }
  } catch {
    // The temp folder could not be made, written or removed: no answer, as for an old git.
    return null;
  }
}
