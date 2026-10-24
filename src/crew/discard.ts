/** Explicit discard's shared preview, lossless git archive, recovery and expiry. Never used by the watch. */
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "../hooks/git";
import { localFiles, safeIgnoredEntry } from "../hooks/local-files";
import { gitEnv } from "../project/git-env";
import type { CrewContext } from "./context";
import { GIT_TIMEOUT_MS, leadRef } from "./end";
import { type CrewRecord, listCrew, updateCrew } from "./store";

/** Both cleaners use this expiry. Proof refs have no expiry: they keep a once-proved merge alive. */
export const CREW_DISCARD_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const DISCARD_IGNORED_FILE_MAX_BYTES = 65_536;
export const DISCARD_IGNORED_TOTAL_MAX_BYTES = 1_048_576;
export const DISCARD_IGNORED_MAX_FILES = 256;
const PREVIEW_FILES = 5;
const PREVIEW_COMMITS = 10;
const TEXT_RULE = `small regular UTF-8 text only (at most ${DISCARD_IGNORED_FILE_MAX_BYTES} bytes each, ${DISCARD_IGNORED_MAX_FILES} files and ${DISCARD_IGNORED_TOTAL_MAX_BYTES} bytes total; no symlinks or binary files)`;

export interface CrewDiscardFacts {
  head: string;
  archiveRef: string;
  token: string;
  unmergedCommits: { count: number | null; subjects: string[] };
  changedFiles: string[];
  ignoredFiles: string[];
  lines: string[];
  question: string;
}

/** Raw NUL lists must not go through runGit's trim: leading spaces can be part of a file name. */
function rawGit(cwd: string, args: string[], ctx: CrewContext, input?: Buffer): Buffer {
  const run = Bun.spawnSync(["git", ...args], {
    cwd,
    env: gitEnv(ctx.env),
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (run.exitCode !== 0 || run.signalCode)
    throw new Error(`git ${args[0]} could not read the work: ${run.stderr.toString().trim()}`);
  return run.stdout;
}
function names(cwd: string, args: string[], ctx: CrewContext): string[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawGit(cwd, args, ctx));
  return text.split("\0").filter((one) => one !== "");
}
function checkedGit(
  cwd: string,
  args: string[],
  ctx: CrewContext,
  own: Record<string, string> = {},
): string {
  const run = runGit(cwd, args, ctx.env, GIT_TIMEOUT_MS, own);
  if (!run.ok) throw new Error(`git ${args[0]} failed: ${run.err}`);
  return run.out;
}
function showFiles(label: string, files: string[]): string {
  return `${files.length} ${label}${
    files.length === 0
      ? ""
      : `: ${files
          .slice(0, PREVIEW_FILES)
          .map((file) => JSON.stringify(file))
          .join(
            ", ",
          )}${files.length > PREVIEW_FILES ? ` and ${files.length - PREVIEW_FILES} more` : ""}`
  }`;
}

/** Expand only protected ignored folders; reuse the cleanup policy for disposable descendants. */
function protectedIgnored(record: CrewRecord, ctx: CrewContext): string[] {
  const roots = localFiles(record.worktree, record.repo, ctx.env);
  if (roots === null)
    throw new Error("git could not list protected ignored files; nothing archived");
  const files: string[] = [];
  let visited = 0;
  const walk = (file: string): void => {
    if (++visited > DISCARD_IGNORED_MAX_FILES * 2)
      throw new Error(`ignored files must be ${TEXT_RULE}`);
    const stat = lstatSync(join(record.worktree, file));
    const entry = stat.isDirectory() ? `${file.replace(/\/$/, "")}/` : file;
    if (safeIgnoredEntry(record.worktree, record.repo, entry)) return;
    if (stat.isDirectory())
      for (const name of readdirSync(join(record.worktree, file)))
        walk(`${file.replace(/\/$/, "")}/${name}`);
    else files.push(file);
  };
  for (const root of roots) walk(root.replace(/\/$/, ""));
  return files.sort();
}

/** Read-only facts and exact confirmation words for the CLI and the portal's off-loop reader. */
export function buildCrewDiscardFacts(record: CrewRecord, ctx: CrewContext): CrewDiscardFacts {
  const head = checkedGit(
    record.repo,
    ["rev-parse", "--verify", `refs/heads/${record.branch}^{commit}`],
    ctx,
  );
  if (
    record.archive === undefined &&
    runGit(
      record.repo,
      ["show-ref", "--verify", "--quiet", `refs/crew-discarded/${record.branch}`],
      ctx.env,
      GIT_TIMEOUT_MS,
    ).ok
  )
    throw new Error(
      `an immutable discard archive already exists for ${record.branch}; recover it first, nothing removed`,
    );
  const symbolic = checkedGit(record.worktree, ["symbolic-ref", "HEAD"], ctx);
  if (symbolic !== `refs/heads/${record.branch}`)
    throw new Error("the worktree is not on its recorded crew branch");
  // A submodule or embedded repository holds files this repository cannot archive completely.
  const stages = rawGit(record.worktree, ["ls-files", "--stage", "-z"], ctx);
  if (rawGit(record.worktree, ["ls-files", "--unmerged", "-z"], ctx).length > 0)
    throw new Error("the index has unresolved conflicts; resolve them before discarding");
  if (
    rawGit(record.worktree, ["ls-files", "-v", "-z"], ctx)
      .toString()
      .split("\0")
      .some((line) => /^[a-zS] /.test(line))
  )
    throw new Error(
      "the index hides files with assume-unchanged or skip-worktree; make them visible before discarding",
    );
  if (
    stages
      .toString()
      .split("\0")
      .some((line) => line.startsWith("160000 "))
  )
    throw new Error("a submodule cannot be archived by crew discard; keep the worktree");
  const untracked = names(
    record.worktree,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    ctx,
  );
  const ignoredFiles = protectedIgnored(record, ctx);
  const changedFiles = [
    ...new Set([
      ...names(record.worktree, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"], ctx),
      ...names(
        record.worktree,
        ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"],
        ctx,
      ),
      ...untracked,
    ]),
  ].sort();
  const hash = createHash("sha256").update(head).update(stages);
  hash.update(
    rawGit(
      record.worktree,
      ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--"],
      ctx,
    ),
  );
  hash.update(
    rawGit(
      record.worktree,
      [
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
      ctx,
    ),
  );
  let ignoredBytes = 0;
  if (ignoredFiles.length > DISCARD_IGNORED_MAX_FILES)
    throw new Error(`ignored files must be ${TEXT_RULE}`);
  for (const file of [...new Set([...changedFiles, ...ignoredFiles])]) {
    hash.update(JSON.stringify(file));
    const path = join(record.worktree, file);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        hash.update("deleted");
        continue;
      }
      throw error;
    }
    const ignored = ignoredFiles.includes(file);
    if (ignored) {
      ignoredBytes += stat.size;
      if (
        !stat.isFile() ||
        stat.size > DISCARD_IGNORED_FILE_MAX_BYTES ||
        ignoredBytes > DISCARD_IGNORED_TOTAL_MAX_BYTES
      )
        throw new Error(
          `ignored file ${JSON.stringify(file)} is not safe to archive: ${TEXT_RULE}`,
        );
      const bytes = readFileSync(path);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(
          `ignored file ${JSON.stringify(file)} is not safe to archive: ${TEXT_RULE}`,
        );
      }
      if (
        [...text].some((char) => {
          const code = char.codePointAt(0) ?? 0;
          return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
        })
      )
        throw new Error(
          `ignored file ${JSON.stringify(file)} is not safe to archive: ${TEXT_RULE}`,
        );
      hash.update(bytes);
    } else if (stat.isSymbolicLink()) {
      hash.update("symlink").update(readlinkSync(path));
    } else if (stat.isFile()) {
      const fd = openSync(path, "r");
      try {
        const chunk = Buffer.alloc(65_536);
        let count = readSync(fd, chunk);
        while (count > 0) {
          hash.update(chunk.subarray(0, count));
          count = readSync(fd, chunk);
        }
      } finally {
        closeSync(fd);
      }
    } else
      throw new Error(
        `file ${JSON.stringify(file)} is not a regular file or symlink; it cannot be archived`,
      );
    hash.update(String(stat.mode));
  }
  const lead = leadRef(record, ctx);
  let count: number | null = null;
  let subjects: string[] = [];
  if (!("why" in lead)) {
    const counted = runGit(
      record.repo,
      ["rev-list", "--count", `${lead.sha}..${head}`],
      ctx.env,
      GIT_TIMEOUT_MS,
    );
    if (counted.ok && /^\d+$/.test(counted.out)) {
      count = Number(counted.out);
      subjects = checkedGit(
        record.repo,
        ["log", `--max-count=${PREVIEW_COMMITS}`, "--format=%s", `${lead.sha}..${head}`],
        ctx,
      )
        .split("\n")
        .filter(Boolean);
    }
  }
  const archiveRef = `refs/crew-discarded/${record.branch}`;
  const lines = [
    `Discard ${record.name}?`,
    `${count ?? "unknown"} unmerged commit${count === 1 ? "" : "s"}${subjects.length === 0 ? "" : ":"}`,
    ...subjects.map((subject) => `  ${subject}`),
    showFiles("uncommitted or untracked files", changedFiles),
    showFiles("files git does not keep", ignoredFiles),
    `Ignored files: ${TEXT_RULE}.`,
    `Stop the session's own leftover programs, archive all work at ${archiveRef}, then remove its worktree, branch and session.`,
    `Recover within 30 days: git branch ${record.branch} ${archiveRef}`,
    "A different staged version is kept in the archive commit's parent; git show <archive>^:<path> reads it.",
  ];
  return {
    head,
    archiveRef,
    token: hash.digest("hex"),
    unmergedCommits: { count, subjects },
    changedFiles,
    ignoredFiles,
    lines,
    question: "Archive this work and remove the crew session?",
  };
}
export const discardPreview = buildCrewDiscardFacts;

/** Create-only refs never overwrite an earlier archive, even when a crew branch name is reused. */
export async function archiveCrewDiscard(
  record: CrewRecord,
  facts: CrewDiscardFacts,
  ctx: CrewContext,
): Promise<CrewRecord> {
  if (buildCrewDiscardFacts(record, ctx).token !== facts.token)
    throw new Error("the work changed since confirmation; preview and confirm it again");
  const dir = mkdtempSync(join(tmpdir(), "crew-discard-"));
  try {
    const index = join(dir, "index");
    const own = { GIT_INDEX_FILE: index, GIT_LITERAL_PATHSPECS: "1" };
    // Snapshot the actual index first: staged content may differ from BOTH HEAD and disk.
    const sourceIndex = checkedGit(
      record.worktree,
      ["rev-parse", "--path-format=absolute", "--git-path", "index"],
      ctx,
    );
    copyFileSync(sourceIndex, index);
    const stagedTree = checkedGit(record.worktree, ["write-tree"], ctx, own);
    let parent = facts.head;
    const headTree = checkedGit(record.repo, ["rev-parse", `${facts.head}^{tree}`], ctx);
    if (stagedTree !== headTree)
      parent = checkedGit(
        record.repo,
        ["commit-tree", stagedTree, "-p", facts.head, "-m", "discarded staged work in progress"],
        ctx,
      );
    checkedGit(record.worktree, ["read-tree", facts.head], ctx, own);
    // Hash disk bytes without clean filters or line-ending conversion. A filter must not
    // silently replace the only copy of the person's uncommitted work in its archive.
    for (const file of [...new Set([...facts.changedFiles, ...facts.ignoredFiles])]) {
      const path = join(record.worktree, file);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          checkedGit(record.worktree, ["update-index", "--force-remove", "--", file], ctx, own);
          continue;
        }
        throw error;
      }
      const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
      const blob = rawGit(record.repo, ["hash-object", "-w", "--stdin"], ctx, bytes)
        .toString()
        .trim();
      const mode = stat.isSymbolicLink()
        ? "120000"
        : (stat.mode & 0o111) !== 0
          ? "100755"
          : "100644";
      checkedGit(
        record.worktree,
        ["update-index", "--add", "--cacheinfo", mode, blob, file],
        ctx,
        own,
      );
    }
    const tree = checkedGit(record.worktree, ["write-tree"], ctx, own);
    const commit = checkedGit(
      record.repo,
      ["commit-tree", tree, "-p", parent, "-m", "discarded work in progress"],
      ctx,
    );
    // A fresh token catches writes while git was reading the files. No working file is rewritten.
    if (buildCrewDiscardFacts(record, ctx).token !== facts.token)
      throw new Error(
        "the work changed while archiving; nothing removed, preview and confirm it again",
      );
    checkedGit(record.repo, ["update-ref", facts.archiveRef, commit, ""], ctx);
    const archive = { ref: facts.archiveRef, head: commit, at: new Date(ctx.now()).toISOString() };
    // Persist recovery BEFORE moving the branch/index. A partial failure leaves every file and ref.
    const saved = await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { archive },
      ctx.now(),
    );
    checkedGit(record.repo, ["update-ref", `refs/heads/${record.branch}`, commit, facts.head], ctx);
    checkedGit(record.worktree, ["read-tree", commit], ctx);
    return saved;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Expire only completed discards and only the exact immutable ref recorded. Returns one line per prune. */
export async function pruneCrewDiscarded(repo: string, ctx: CrewContext): Promise<string[]> {
  const listed = listCrew(ctx.paths.stateDir, repo);
  if (listed.broken.length > 0) return [];
  const lines: string[] = [];
  for (const record of listed.records) {
    const archive = record.archive;
    if (record.state !== "discarded" || archive === undefined || archive.prunedAt !== undefined)
      continue;
    const age = ctx.now() - Date.parse(archive.at);
    if (
      !Number.isFinite(age) ||
      age <= CREW_DISCARD_RETENTION_MS ||
      archive.ref !== `refs/crew-discarded/${record.branch}`
    )
      continue;
    const removed = runGit(
      repo,
      ["update-ref", "-d", archive.ref, archive.head],
      ctx.env,
      GIT_TIMEOUT_MS,
    );
    if (!removed.ok) {
      ctx.error(`crew discard: could not prune ${archive.ref}: ${removed.err}`);
      continue;
    }
    await updateCrew(
      ctx.paths.stateDir,
      repo,
      record.id,
      { archive: { ...archive, prunedAt: new Date(ctx.now()).toISOString() } },
      ctx.now(),
    );
    lines.push(`pruned ${archive.ref} (discarded more than 30 days ago)`);
  }
  return lines;
}
