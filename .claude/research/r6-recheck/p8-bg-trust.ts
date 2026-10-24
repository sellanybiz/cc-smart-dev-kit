/**
 * P8, the `--bg` half — the lead runs this; a crew session may not (`bgMode`).
 *
 * A fresh throwaway config. A never-trusted git repo whose settings.local.json names L; the
 * shell names D and carries no key; a `--settings` file carries only an `apiKeyHelper` with the
 * fake key (the credential a `--bg` session takes, P10), so the URL can only come from the
 * project's file or the shell.
 * 1. `claude --bg` there, untrusted. Expected (GP0): exit 1, stderr `Workspace not trusted. …`,
 *    no session, no request.
 * 2. The same after a trust record is added. Expected: `backgrounded · <id>`, and its message
 *    request reaches L, never D.
 * Then `claude logs`, `stop` and `rm` of the session, and every process left with this
 * config is ended.
 *
 * Run: `R6_TMP=<temp folder> bun .claude/research/r6-recheck/p8-bg-trust.ts [--dry-run]`
 */
import { join } from "node:path";
import {
  baseEnv,
  bgEnd,
  bgMode,
  bgStart,
  claudeVersion,
  endLeftovers,
  FAKE_KEY,
  gitRepo,
  helloTo,
  makeWorld,
  messagesTo,
  placeSettings,
  report,
  startFakes,
  trust,
  waitFor,
  writeJson,
} from "./lib.ts";

const mode = bgMode();
const world = makeWorld("p8bg");
const fakes = startFakes(["L", "D"]);
const result: Record<string, unknown> = { proof: "P8 (--bg)", claude: await claudeVersion(), mode };
try {
  const dir = await gitRepo(world, join(world.root, "proj"));
  placeSettings(fakes, join(dir, ".claude", "settings.local.json"), "L");
  const helper = join(world.root, "key-helper.json");
  writeJson(helper, { apiKeyHelper: `echo ${FAKE_KEY}` });
  const env = baseEnv(world, fakes.url("D"));
  delete env.ANTHROPIC_API_KEY;
  const args = ["--settings", helper, "--model", "haiku", "--strict-mcp-config", "--", "Say ok"];

  let from = fakes.log.length;
  const untrusted = await bgStart(mode, dir, env, args);
  await Bun.sleep(mode === "run" ? 5000 : 0);
  result.untrusted = {
    command: untrusted.command,
    exitCode: untrusted.exitCode,
    stdout: untrusted.stdout.trim(),
    stderr: untrusted.stderr.trim(),
    requests: fakes.log.slice(from).map((e) => `${e.label} ${e.method} ${e.path}`),
  };
  if (untrusted.id && mode === "run") {
    result.untrustedEnd = await bgEnd(dir, env, untrusted.id);
  }

  await trust(world, dir);
  from = fakes.log.length;
  const trusted = await bgStart(mode, dir, env, args);
  if (mode === "run") await waitFor(() => messagesTo(fakes.log, from).length > 0, 90_000, 500);
  result.trusted = {
    command: trusted.command,
    exitCode: trusted.exitCode,
    stdout: trusted.stdout.trim(),
    stderr: trusted.stderr.trim(),
    helloTo: helloTo(fakes.log, from).join(","),
    messagesTo: messagesTo(fakes.log, from).join(","),
  };
  if (trusted.id && mode === "run") {
    await Bun.sleep(3000);
    result.trustedEnd = await bgEnd(dir, env, trusted.id);
  }
} finally {
  fakes.stop();
  if (mode === "run") result.leftoversEnded = endLeftovers(world);
}
report(world, result, fakes.log);
