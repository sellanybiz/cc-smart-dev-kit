// The SessionStart hook that keeps anymodel up to date (plugin/hooks/hooks.json), and,
// with `--background`, the detached check it starts. The hook returns at once: it only
// records the session, brings the instructions copy up to this version when it is behind
// (the copy only, quietly), and starts the check when one is due (src/update/background.ts).
import { PLUGIN, VERSION } from "../build-info";
import { cliPaths } from "../cli/paths";
import { instructionsFolder, instructionsPaths } from "../setup/instructions";
import { capturingRunner, commandContext, notifyCommand } from "../update/apply";
import {
  backgroundCheck,
  refreshInstructionsAtSessionStart,
  sessionStart,
} from "../update/background";

const env = process.env;
const paths = cliPaths(env);

/** The Claude session's process: Claude Code sets CLAUDE_PID for its hooks; else the parent. */
function sessionPid(): null | number {
  const pid = Number(env.CLAUDE_PID ?? process.ppid);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

if (process.argv.includes("--background")) {
  const which = (command: string) => Bun.which(command, { PATH: env.PATH ?? "" });
  const run = capturingRunner(env, paths.home);
  await backgroundCheck({
    paths,
    env,
    now: () => Date.now(),
    claude: which("claude"),
    run,
    notify: (text) => {
      const argv = notifyCommand(text, process.platform, which);
      if (argv !== null) run(argv);
    },
  });
} else {
  try {
    const answer = sessionStart({
      paths,
      env,
      nowMs: Date.now(),
      sessionPid: sessionPid(),
      version: VERSION,
      spawnBackground: () => {
        // Detached (its own session, setsid) with no pipe to this hook: it outlives the
        // hook, and Claude Code never waits for it. In the home folder, without the git
        // variables of the session's repo (`commandContext`).
        Bun.spawn([process.execPath, Bun.main, "--background"], {
          ...commandContext(env, paths.home),
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
        }).unref();
      },
    });
    if (answer !== "") process.stdout.write(`${answer}\n`);
    // The new version's first session start refreshes the instructions copy it ships
    // (`instructionsNeedRefresh`): the copy only, quietly, and never in the way of the
    // session. Nothing on stdout — a session start's text goes into Claude's context.
    await refreshInstructionsAtSessionStart({
      where: instructionsPaths(paths, instructionsFolder(import.meta.dir)),
      version: VERSION,
      log: (line) => console.error(line),
    });
  } catch (error) {
    // A bug here must never stop a session: one line, and exit 0.
    console.error(`${PLUGIN} update check: ${error instanceof Error ? error.message : error}`);
  }
}
