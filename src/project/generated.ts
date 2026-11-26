/**
 * Which files a commit marks generated: the `linguist-generated` attribute, set or `true`, read
 * from that commit's own `.gitattributes` files and from nothing else.
 *
 * The review count leaves such files out (`src/workflow/review-cover.ts`), so a mark must come
 * from the base a pull request merges into, never from the checkout that asks. `git check-attr
 * --source=<commit>` reads the commit's `.gitattributes`, but git still adds three local files
 * on top (gitattributes(5)): `$GIT_DIR/info/attributes`, the file `core.attributesFile` names
 * (by default `$XDG_CONFIG_HOME/git/attributes`), and the system file. A session could write any
 * of them without a commit and mark every file generated. So each call runs with:
 *
 * - a throwaway git folder (`GIT_DIR`) that borrows the repository's objects through
 *   `objects/info/alternates`, so the repository's own `info/attributes` and config are not read;
 * - `-c core.attributesFile=`, empty, so no personal attributes file is read;
 * - `GIT_ATTR_NOSYSTEM=1`, so the system file is not read (git(1); a test cannot write the
 *   system file, so this one rests on the docs alone).
 *
 * `--source` came in git 2.40: on an older git the call fails, and a caller takes a failed call
 * on the safe side (no file is generated, or no answer), never as a mark. This module only builds
 * the calls, the folder and the reading of their output: each caller runs git its own way
 * (review-cover asynchronously, inside its deadline).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";

/** The attribute that marks a file generated: GitHub Linguist's name, which projects use. */
export const GENERATED_ATTRIBUTE = "linguist-generated";

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
 * The `git check-attr` calls that ask which of `paths` commit `source` marks generated: one
 * argument list for each batch of `PATHS_PER_CALL` paths, none for no paths. `source` is a full
 * commit id, since the throwaway folder holds no refs. Run each with `openBaseOnlyGit`'s `env`.
 */
export function generatedChecks(source: string, paths: readonly string[]): string[][] {
  const checks: string[][] = [];
  for (let at = 0; at < paths.length; at += PATHS_PER_CALL) {
    checks.push([
      "-c",
      "core.attributesFile=",
      "check-attr",
      `--source=${source}`,
      "-z",
      GENERATED_ATTRIBUTE,
      "--",
      ...paths.slice(at, at + PATHS_PER_CALL),
    ]);
  }
  return checks;
}

/** The paths one `generatedChecks` call's output (`path NUL attribute NUL value NUL`) marks. */
export function generatedIn(out: string): string[] {
  const fields = out.split("\0");
  const generated: string[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index] ?? "";
    if (path !== "" && MARKED_VALUES.has(fields[index + 2] ?? "")) generated.push(path);
  }
  return generated;
}

/** A throwaway git folder that reads a repository's objects and nothing else of it. */
export interface BaseOnlyGit {
  /** The variables each `generatedChecks` call sets, after `gitEnv` drops the inherited ones. */
  env: Record<string, string>;
  /** Removes the folder. */
  remove(): void;
}

/**
 * A throwaway git folder for the repository whose common git folder is `commonDir`, made for
 * reading the attributes of commit `source` (its id says whether the objects are sha-1 or
 * sha-256). The caller removes it when its calls are done.
 */
export function openBaseOnlyGit(commonDir: string, source: string): BaseOnlyGit {
  const folder = mkdtempSync(join(tmpdir(), `${COMMAND}-attributes-`));
  try {
    mkdirSync(join(folder, "refs"));
    mkdirSync(join(folder, "objects", "info"), { recursive: true });
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
  return {
    env: { GIT_DIR: folder, GIT_ATTR_NOSYSTEM: "1" },
    remove: () => rmSync(folder, { recursive: true, force: true }),
  };
}
