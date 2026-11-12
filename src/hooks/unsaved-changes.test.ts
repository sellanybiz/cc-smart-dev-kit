import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { removeWorktree, scanWorktrees } from "../worktrees/scan";
import { hasUnsavedChanges } from "./unsaved-changes";

const BASE = "refs/remotes/origin/main";

/**
 * A repo whose base moved on after the worktree was made: `a.txt` went v1 → v2 → v3 on main,
 * `gone.txt` was deleted there, and the worktree still sits on the first commit (v1). That is
 * the state of a builder that never committed while its lead committed its files elsewhere.
 */
function world(branch?: string) {
  const root = tempDir("unsaved-changes");
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "a.txt"), "v1\n");
  writeFileSync(join(main, "gone.txt"), "old\n");
  writeFileSync(join(main, "kept.txt"), "kept\n");
  writeFileSync(join(main, " lead.txt"), "leading space\n");
  writeFileSync(join(main, "run.sh"), "#!/bin/sh\n");
  chmodSync(join(main, "run.sh"), 0o755);
  git(main, "add", ".");
  git(main, "commit", "-qm", "first");
  const first = git(main, "rev-parse", "HEAD").trim();
  writeFileSync(join(main, "a.txt"), "v2\n");
  writeFileSync(join(main, "new file.txt"), "added on main\n");
  writeFileSync(join(main, "tool.sh"), "#!/bin/sh\n");
  chmodSync(join(main, "tool.sh"), 0o755);
  git(main, "rm", "-q", "gone.txt");
  git(main, "add", ".");
  git(main, "commit", "-qm", "second");
  writeFileSync(join(main, "a.txt"), "v3\n");
  git(main, "commit", "-qam", "third");
  git(main, "update-ref", BASE, "HEAD");
  if (branch === undefined) git(main, "worktree", "add", "-q", "--detach", worktree, first);
  else git(main, "worktree", "add", "-q", "-b", branch, worktree, first);
  const unsaved = () => hasUnsavedChanges(worktree, BASE, cleanGitEnv());
  return { root, main, worktree, unsaved };
}

describe("hasUnsavedChanges", () => {
  test("a clean folder holds nothing unsaved", () => {
    expect(world().unsaved()).toBe(false);
  });

  test("an edit whose bytes the base committed at that path is saved", () => {
    const { worktree, unsaved } = world();
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    expect(unsaved()).toBe(false);
  });

  test("an older version from the base's history is saved too: git can give it back", () => {
    const { worktree, unsaved } = world();
    writeFileSync(join(worktree, "a.txt"), "v2\n");
    expect(unsaved()).toBe(false);
  });

  test("a version from before the folder's own HEAD is unsaved: putting it back was a choice", () => {
    const { main, worktree, unsaved } = world();
    // Move the folder's HEAD past v2, then put v2 back by hand.
    git(worktree, "checkout", "-q", "--detach", git(main, "rev-parse", "HEAD").trim());
    writeFileSync(join(worktree, "a.txt"), "v2\n");
    expect(unsaved()).toBe(true);
  });

  test("an edit the base never held is unsaved", () => {
    const { worktree, unsaved } = world();
    writeFileSync(join(worktree, "a.txt"), "only here\n");
    expect(unsaved()).toBe(true);
  });

  test("an untracked file is saved only at the path the base holds it, spaces included", () => {
    const saved = world();
    writeFileSync(join(saved.worktree, "new file.txt"), "added on main\n");
    expect(saved.unsaved()).toBe(false);

    const moved = world();
    writeFileSync(join(moved.worktree, "elsewhere.txt"), "added on main\n");
    expect(moved.unsaved()).toBe(true);
  });

  test("a deletion is saved only when the base deleted the file too", () => {
    const saved = world();
    rmSync(join(saved.worktree, "gone.txt"));
    expect(saved.unsaved()).toBe(false);

    const stillThere = world();
    rmSync(join(stillThere.worktree, "kept.txt"));
    expect(stillThere.unsaved()).toBe(true);
  });

  test("a deleted name that starts with a space is judged on its whole name", () => {
    const { worktree, unsaved } = world();
    rmSync(join(worktree, " lead.txt"));
    expect(unsaved()).toBe(true);
  });

  test("with ownDeletions, a file the folder lacks is the removal's own, staged ones are not", () => {
    const missing = world();
    rmSync(join(missing.worktree, "kept.txt"));
    const env = cleanGitEnv();
    expect(hasUnsavedChanges(missing.worktree, BASE, env, { ownDeletions: true })).toBe(false);
    expect(hasUnsavedChanges(missing.worktree, BASE, env)).toBe(true);

    const staged = world();
    git(staged.worktree, "rm", "-q", "kept.txt");
    expect(hasUnsavedChanges(staged.worktree, BASE, env, { ownDeletions: true })).toBe(true);
  });

  test("a file with a filter driver is judged on its bytes on disk, not the filtered ones", () => {
    const { main, worktree, unsaved } = world();
    // A clean filter that drops lines, as a notebook output stripper does.
    git(main, "config", "filter.strip.clean", "grep -v '^OUTPUT'");
    git(main, "config", "core.attributesFile", join(main, "..", "attributes"));
    writeFileSync(join(main, "..", "attributes"), "a.txt filter=strip\n");
    writeFileSync(join(worktree, "a.txt"), "v3\nOUTPUT: three hours of compute\n");
    expect(unsaved()).toBe(true);
  });

  test("a staged version the base never held is unsaved, even when the folder's copy is saved", () => {
    const { worktree, unsaved } = world();
    writeFileSync(join(worktree, "a.txt"), "staged only\n");
    git(worktree, "add", "a.txt");
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    expect(unsaved()).toBe(true);
  });

  test("a staged version the base committed is saved", () => {
    const { worktree, unsaved } = world();
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    git(worktree, "add", "a.txt");
    expect(unsaved()).toBe(false);
  });

  test("a staged rename is saved only when the base also lost the old path", () => {
    const saved = world();
    git(saved.worktree, "mv", "gone.txt", "renamed.txt");
    // The base never had renamed.txt, so its bytes are unsaved; give the base the same file.
    writeFileSync(join(saved.main, "renamed.txt"), "old\n");
    git(saved.main, "add", "renamed.txt");
    git(saved.main, "commit", "-qm", "renamed on main");
    git(saved.main, "update-ref", BASE, "HEAD");
    expect(saved.unsaved()).toBe(false);

    const stillThere = world();
    git(stillThere.worktree, "mv", "kept.txt", "renamed.txt");
    writeFileSync(join(stillThere.main, "renamed.txt"), "kept\n");
    git(stillThere.main, "add", "renamed.txt");
    git(stillThere.main, "commit", "-qm", "copied on main");
    git(stillThere.main, "update-ref", BASE, "HEAD");
    expect(stillThere.unsaved()).toBe(true);
  });

  test("a version only another branch holds is unsaved", () => {
    const { main, worktree, unsaved } = world();
    git(main, "switch", "-qc", "side");
    writeFileSync(join(main, "a.txt"), "side only\n");
    git(main, "commit", "-qam", "side");
    writeFileSync(join(worktree, "a.txt"), "side only\n");
    expect(unsaved()).toBe(true);
  });

  test("a version made by a merge's own conflict resolution is saved", () => {
    const { main, worktree, unsaved } = world();
    git(main, "switch", "-qc", "side");
    writeFileSync(join(main, "a.txt"), "side\n");
    git(main, "commit", "-qam", "side");
    git(main, "switch", "-q", "main");
    writeFileSync(join(main, "a.txt"), "main\n");
    git(main, "commit", "-qam", "main");
    // A merge whose resolution is text neither side had: only the merge commit holds it.
    git(main, "merge", "-q", "--no-ff", "--no-commit", "-s", "ours", "side");
    writeFileSync(join(main, "a.txt"), "resolved\n");
    git(main, "add", "a.txt");
    git(main, "commit", "-qm", "merge side");
    git(main, "update-ref", BASE, "HEAD");
    writeFileSync(join(worktree, "a.txt"), "resolved\n");
    expect(unsaved()).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "a mode the base never had is unsaved, though the bytes match",
    () => {
      const { worktree, unsaved } = world();
      writeFileSync(join(worktree, "a.txt"), "v3\n");
      chmodSync(join(worktree, "a.txt"), 0o755);
      expect(unsaved()).toBe(true);
    },
  );

  test.skipIf(process.platform === "win32")(
    "an untracked symlink is unsaved, though the bytes it points at match",
    () => {
      const { root, worktree, unsaved } = world();
      // The base holds tool.sh as an executable file with these bytes; here it is a link.
      const target = join(root, "target.sh");
      writeFileSync(target, "#!/bin/sh\n");
      chmodSync(target, 0o755);
      symlinkSync(target, join(worktree, "tool.sh"));
      expect(unsaved()).toBe(true);
    },
  );

  test.skipIf(process.platform === "win32")(
    "a tracked file turned into a symlink is unsaved, though the bytes it points at match",
    () => {
      const { root, worktree, unsaved } = world();
      // run.sh is an executable file on the base with these bytes; here it becomes a link.
      const target = join(root, "target.sh");
      writeFileSync(target, "#!/bin/sh\n");
      chmodSync(target, 0o755);
      rmSync(join(worktree, "run.sh"));
      symlinkSync(target, join(worktree, "run.sh"));
      expect(unsaved()).toBe(true);
    },
  );

  test("a ref git cannot read keeps it: unsaved", () => {
    const { worktree } = world();
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    expect(hasUnsavedChanges(worktree, "refs/remotes/origin/nothing", cleanGitEnv())).toBe(true);
  });
});

describe("worktrees removes a folder whose edits the base holds", () => {
  const options = (main: string) => ({
    base: "main",
    claudeConfigDir: join(main, "..", "claude"),
    env: cleanGitEnv(),
    idleLimit: 0,
    facts: { containers: [], mounts: [], programs: [], sessions: [] },
  });
  const listedOf = (main: string, worktree: string) => {
    const found = scanWorktrees(main, options(main)).find((one) => one.listed.path === worktree);
    if (found === undefined) throw new Error("the worktree is not listed");
    return found.listed;
  };

  test("on a branch, saved edits: removed in one run, with nothing left beside it", () => {
    const { root, main, worktree } = world("worktree-agent-a1");
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    rmSync(join(worktree, "gone.txt"));
    const removal = removeWorktree(main, listedOf(main, worktree), options(main));
    expect(removal.status).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
    expect(readdirSync(root).filter((name) => name.includes("-removing-"))).toEqual([]);
  });

  test("one unsaved edit: kept, and the folder is not moved", () => {
    const { main, worktree } = world("worktree-agent-a2");
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    writeFileSync(join(worktree, "draft.txt"), "only here\n");
    const removal = removeWorktree(main, listedOf(main, worktree), options(main));
    expect(removal.status).toBe("kept");
    expect(existsSync(join(worktree, "draft.txt"))).toBe(true);
  });

  test("a folder an earlier removal moved aside, holding saved edits and its own deletions, goes", () => {
    const { main, worktree } = world("worktree-agent-a3");
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    const parked = `${worktree}-removing-1700000000000`;
    git(main, "worktree", "move", worktree, parked);
    rmSync(join(parked, "kept.txt"));
    const removal = removeWorktree(main, listedOf(main, parked), options(main));
    expect(removal.status).toBe("removed");
    expect(existsSync(parked)).toBe(false);
  });
});

describe("worktrees judges saved edits as finished", () => {
  function state(main: string, worktree: string) {
    return scanWorktrees(main, {
      base: "main",
      claudeConfigDir: join(main, "..", "claude"),
      env: cleanGitEnv(),
      idleLimit: 0,
      facts: { containers: [], mounts: [], programs: [], sessions: [] },
    }).find((one) => one.listed.path === worktree)?.state;
  }

  test("a folder whose every edit the base holds is finished", () => {
    const { main, worktree } = world();
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    rmSync(join(worktree, "gone.txt"));
    expect(state(main, worktree)).toMatchObject({ finished: true });
  });

  test("one edit the base lacks keeps it, as uncommitted changes", () => {
    const { main, worktree } = world();
    writeFileSync(join(worktree, "a.txt"), "v3\n");
    writeFileSync(join(worktree, "draft.txt"), "only here\n");
    expect(state(main, worktree)).toMatchObject({ finished: false, why: "uncommitted changes" });
  });
});
