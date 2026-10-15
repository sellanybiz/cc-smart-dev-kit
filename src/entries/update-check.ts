// The SessionStart hook that keeps anymodel up to date (plugin/hooks/hooks.json), and,
// with `--background`, the detached check it starts. The hook returns at once: it only
// records the session and starts the check when one is due (src/update/background.ts).
import { PLUGIN, VERSION } from "../build-info";
import { cliPaths } from "../cli/paths";
import { capturingRunner, notifyCommand } from "../update/apply";
import { backgroundCheck, sessionStart } from "../update/background";

const env = process.env;
const paths = cliPaths(env);

/** The Claude session's process: Claude Code sets CLAUDE_PID for its hooks; else the parent. */
function sessionPid(): null | number {
  const pid = Number(env.CLAUDE_PID ?? process.ppid);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

if (process.argv.includes("--background")) {
  const which = (command: string) => Bun.which(command, { PATH: env.PATH ?? "" });
  await backgroundCheck({
    paths,
    env,
    now: () => Date.now(),
    claude: which("claude"),
    run: capturingRunner(env),
    notify: (text) => {
      const argv = notifyCommand(text, process.platform, which);
      if (argv !== null) capturingRunner(env)(argv);
    },
  });
} else {
  try {
    const answer = sessionStart({
      paths,
      nowMs: Date.now(),
      sessionPid: sessionPid(),
      version: VERSION,
      spawnBackground: () => {
        // Detached (its own session, setsid) with no pipe to this hook: it outlives the
        // hook, and Claude Code never waits for it.
        Bun.spawn([process.execPath, Bun.main, "--background"], {
          detached: true,
          env,
          stdio: ["ignore", "ignore", "ignore"],
        }).unref();
      },
    });
    if (answer !== "") process.stdout.write(`${answer}\n`);
  } catch (error) {
    // A bug here must never stop a session: one line, and exit 0.
    console.error(`${PLUGIN} update check: ${error instanceof Error ? error.message : error}`);
  }
}
