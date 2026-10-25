/**
 * P4 — any settings file's `env` beats a shell export of the same key.
 *
 * The shell always exports D; one file at a time names its own fake (S: a `--settings` file,
 * L: the project's settings.local.json, P: the project's settings.json, U: the user file).
 * One `claude -p` per case in a fresh trusted git repo.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p4-file-beats-shell.ts`
 */
import { join } from "node:path";
import {
  claudeVersion,
  makeWorld,
  report,
  runSourcesCase,
  type Sources,
  startFakes,
  trust,
} from "./lib.ts";

const CASES: { name: string; sources: Sources; expect: string }[] = [
  { name: "local + shell", sources: { local: "L", shell: "D" }, expect: "L" },
  { name: "shared + shell", sources: { shared: "P", shell: "D" }, expect: "P" },
  { name: "user + shell", sources: { user: "U", shell: "D" }, expect: "U" },
  { name: "--settings + shell", sources: { settingsFlag: "S", shell: "D" }, expect: "S" },
  { name: "no file, shell only", sources: { shell: "D" }, expect: "D" },
];

const world = makeWorld("p4");
const fakes = startFakes(["S", "L", "P", "U", "D"]);
const rows = [];
try {
  for (const [index, c] of CASES.entries()) {
    const dir = join(world.root, `proj-${index + 1}`);
    await trust(world, dir);
    const result = await runSourcesCase(world, fakes, dir, c.sources);
    rows.push({
      case: c.name,
      messageTo: result.messages.join(","),
      helloTo: result.hello.join(","),
      expect: c.expect,
      holds: result.messages.length > 0 && result.messages.every((m) => m === c.expect),
      exitCode: result.exitCode,
      stdout: result.stdout,
    });
  }
} finally {
  fakes.stop();
}
report(world, { proof: "P4", claude: await claudeVersion(), rows }, fakes.log);
