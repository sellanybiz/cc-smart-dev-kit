/**
 * P6 — where the two project files are read from: the main checkout, a subfolder of it, and a
 * linked worktree.
 *
 * A throwaway git repo (the main checkout) with a subfolder `sub` and a linked worktree `wt`,
 * and a `plain` folder outside any git repo.
 * Fakes: L (the main root's settings.local.json), P (the main root's settings.json), C (a file
 * in the subfolder or the worktree), D (the shell). Each case sets exactly the files it names,
 * runs one `claude -p` in its folder, and records the fake the message request reached. Every
 * folder is trusted.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p6-file-locations.ts`
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  baseEnv,
  claudeVersion,
  git,
  gitRepo,
  helloTo,
  makeWorld,
  messagesTo,
  NO_KEY,
  placeSettings,
  printArgs,
  report,
  runClaude,
  startFakes,
  trust,
} from "./lib.ts";

type Where = "main" | "sub" | "wt" | "plain";
type Files = {
  mainLocal?: string;
  mainShared?: string;
  subLocal?: string;
  subShared?: string;
  wtLocal?: string;
  wtShared?: string;
  plainLocal?: string;
};
type Case = { name: string; cwd: Where; files: Files; gp0: string; commitSharedFirst?: boolean };

// GP0's ten rows, in its order, then the cases that sharpen "a local file anywhere else is
// ignored" (with no local file at the main root to hide it).
const CASES: Case[] = [
  {
    name: "1 main root: local + shared",
    cwd: "main",
    files: { mainLocal: "L", mainShared: "P" },
    gp0: "L",
  },
  {
    name: "2 subfolder, none of its own",
    cwd: "sub",
    files: { mainLocal: "L", mainShared: "P" },
    gp0: "L",
  },
  {
    name: "3 subfolder, its own local",
    cwd: "sub",
    files: { mainLocal: "L", mainShared: "P", subLocal: "C" },
    gp0: "L",
  },
  {
    name: "4 worktree, none of its own",
    cwd: "wt",
    files: { mainLocal: "L", mainShared: "P" },
    gp0: "L",
  },
  {
    name: "5 worktree, its own local",
    cwd: "wt",
    files: { mainLocal: "L", mainShared: "P", wtLocal: "C" },
    gp0: "L",
  },
  { name: "6 main root, local removed", cwd: "main", files: { mainShared: "P" }, gp0: "P" },
  {
    name: "7 subfolder, shared only at the main root",
    cwd: "sub",
    files: { mainShared: "P" },
    gp0: "D",
  },
  {
    name: "8 subfolder, its own shared",
    cwd: "sub",
    files: { mainShared: "P", subShared: "C" },
    gp0: "C",
  },
  {
    name: "9 worktree, the main root's shared untracked",
    cwd: "wt",
    files: { mainShared: "P" },
    gp0: "D",
  },
  {
    name: "10 worktree, the shared file committed and merged in",
    cwd: "wt",
    files: { mainShared: "P" },
    gp0: "P",
    commitSharedFirst: true,
  },
  {
    name: "11 subfolder, its own local, none at the main root",
    cwd: "sub",
    files: { subLocal: "C" },
    gp0: "(not run)",
  },
  {
    name: "12 worktree, its own local, none at the main root",
    cwd: "wt",
    files: { wtLocal: "C" },
    gp0: "(not run)",
  },
  {
    name: "13 subfolder, its own shared, the main root's local",
    cwd: "sub",
    files: { mainLocal: "L", subShared: "C" },
    gp0: "(not run)",
  },
  {
    name: "14 subfolder, its own local, the main root's local without the key",
    cwd: "sub",
    files: { mainLocal: NO_KEY, subLocal: "C" },
    gp0: "(not run)",
  },
  {
    name: "15 worktree, its own local, the main root's local without the key",
    cwd: "wt",
    files: { mainLocal: NO_KEY, wtLocal: "C" },
    gp0: "(not run)",
  },
  {
    name: "16 worktree, its own local, the main root's shared committed",
    cwd: "wt",
    files: { mainShared: "P", wtShared: "P", wtLocal: "C" },
    gp0: "(not run)",
  },
  {
    name: "17 a folder outside any git repo, its own local",
    cwd: "plain",
    files: { plainLocal: "C" },
    gp0: "(not run)",
  },
];

const world = makeWorld("p6");
const fakes = startFakes(["L", "P", "C", "D"]);
const main = await gitRepo(world, join(world.root, "main"));
const sub = join(main, "sub");
mkdirSync(sub, { recursive: true });
const wt = join(world.root, "wt");
await git(world, main, "worktree", "add", "-q", "-b", "wt", wt);
// No git repo may sit above the world: run with R6_TMP outside any checkout.
const plain = join(world.root, "plain");
mkdirSync(plain, { recursive: true });
const folders: Record<Where, string> = { main, sub, wt, plain };
for (const folder of Object.values(folders)) await trust(world, folder);

const rows = [];
try {
  for (const c of CASES) {
    if (c.commitSharedFirst) {
      placeSettings(fakes, join(main, ".claude", "settings.json"), "P");
      await git(world, main, "add", ".claude/settings.json");
      await git(world, main, "commit", "-q", "-m", "shared settings");
      await git(world, wt, "merge", "-q", "--ff-only", "main");
    }
    placeSettings(fakes, join(main, ".claude", "settings.local.json"), c.files.mainLocal);
    placeSettings(fakes, join(main, ".claude", "settings.json"), c.files.mainShared);
    placeSettings(fakes, join(sub, ".claude", "settings.local.json"), c.files.subLocal);
    placeSettings(fakes, join(sub, ".claude", "settings.json"), c.files.subShared);
    placeSettings(fakes, join(wt, ".claude", "settings.local.json"), c.files.wtLocal);
    placeSettings(fakes, join(plain, ".claude", "settings.local.json"), c.files.plainLocal);
    if (!c.commitSharedFirst) {
      placeSettings(fakes, join(wt, ".claude", "settings.json"), c.files.wtShared);
    }
    const from = fakes.log.length;
    const run = await runClaude({
      cwd: folders[c.cwd],
      args: printArgs("Say ok"),
      env: baseEnv(world, fakes.url("D")),
      timeoutMs: 90_000,
    });
    const messages = messagesTo(fakes.log, from);
    rows.push({
      case: c.name,
      messageTo: messages.join(","),
      helloTo: helloTo(fakes.log, from).join(","),
      gp0: c.gp0,
      agrees:
        c.gp0 === "(not run)" ? null : messages.length > 0 && messages.every((m) => m === c.gp0),
      exitCode: run.exitCode,
      stdout: run.stdout.trim(),
    });
  }
} finally {
  fakes.stop();
}
report(world, { proof: "P6", claude: await claudeVersion(), rows }, fakes.log);
