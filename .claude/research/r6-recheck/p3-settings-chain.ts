/**
 * P3 — the settings order for an `env` key: `--settings` > local > shared > user > shell.
 *
 * One fake per source (S: the `--settings` file, L: the project's settings.local.json, P: the
 * project's settings.json, U: the user file in the throwaway config, D: the shell's export).
 * Each case runs one `claude -p` in a fresh trusted git repo with only its sources in play,
 * and records which fake got the message request and which got the startup `HEAD /api/hello`.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p3-settings-chain.ts`
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

type Case = { name: string; sources: Sources; gp0: string };

// GP0's eight runs, with its labels mapped onto ours (its A = P, B = L, C = S, D = D; its
// second set's B2/H/C2/G = U/P/L/D), plus the user file against the shell alone.
const CASES: Case[] = [
  {
    name: "1 --settings, local, shared, shell",
    sources: { settingsFlag: "S", local: "L", shared: "P", shell: "D" },
    gp0: "S",
  },
  { name: "2 local, shared, shell", sources: { local: "L", shared: "P", shell: "D" }, gp0: "L" },
  { name: "3 shared, shell", sources: { shared: "P", shell: "D" }, gp0: "P" },
  { name: "4 shell", sources: { shell: "D" }, gp0: "D" },
  {
    name: "5 user, --settings, shell",
    sources: { user: "U", settingsFlag: "S", shell: "D" },
    gp0: "S",
  },
  { name: "6 user, shared, shell", sources: { user: "U", shared: "P", shell: "D" }, gp0: "P" },
  { name: "7 user, local, shell", sources: { user: "U", local: "L", shell: "D" }, gp0: "L" },
  {
    name: "8 user, shared, local, shell",
    sources: { user: "U", shared: "P", local: "L", shell: "D" },
    gp0: "L",
  },
  { name: "9 user, shell", sources: { user: "U", shell: "D" }, gp0: "(not run)" },
];

const world = makeWorld("p3");
const fakes = startFakes(["S", "L", "P", "U", "D"]);
const rows = [];
try {
  for (const [index, c] of CASES.entries()) {
    const dir = join(world.root, `proj-${index + 1}`);
    await trust(world, dir);
    const result = await runSourcesCase(world, fakes, dir, c.sources);
    rows.push({ case: c.name, gp0: c.gp0, ...result });
  }
} finally {
  fakes.stop();
}
report(
  world,
  {
    proof: "P3",
    claude: await claudeVersion(),
    rows: rows.map((r) => ({
      case: r.case,
      messageTo: r.messages.join(","),
      helloTo: r.hello.join(","),
      gp0: r.gp0,
      agrees:
        r.gp0 === "(not run)"
          ? null
          : r.messages.every((m) => m === r.gp0) && r.messages.length > 0,
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
    })),
  },
  fakes.log,
);
