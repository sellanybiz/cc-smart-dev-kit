import { stringField } from "../io";
import { jobRoute, routeFacts } from "../job-route";
import type { HookSpec } from "../run";

/**
 * The job queue's door, the kit's one guard: PreToolUse on Bash and PowerShell, **machine-wide**,
 * and `alwaysOn` (`ownHooks` cannot switch it off). The route is the `switches.jobRoute` switch
 * (the project's `"jobs": { "route": true }` over the person's machine-wide default, one
 * resolver, off until one says on): a heavy command is rewritten to run through
 * `cc-smart-dev-kit job run` (or refused with that command line), a heavy run mixed with other
 * commands is refused, and a heavy PowerShell line is refused, naming the Bash tool, where Git
 * Bash lets that tool run. Off, a heavy command runs raw.
 *
 * It never asks the person. With a broken or too new `cc-smart-dev-kit.json` it routes by the
 * person's own default, as if the project's file were absent. Outside git there is no project to
 * route for, and after a crash there is nothing to answer: the line runs as written, and a crash
 * is one line on stderr.
 */
export const jobRouteHook: HookSpec = {
  name: "job-route",
  events: ["PreToolUse"],
  alwaysOn: true,
  // The file cannot be read, so its `jobs` part is unknown: the person's own default decides.
  onConfigProblem: (_message, input, event, checkout, context) =>
    jobRoute({
      input,
      event,
      cwd: stringField(input.cwd) ?? checkout.root,
      project: { ...checkout, config: null, configFile: null },
      env: context.env,
      paths: context.paths,
      nowMs: context.nowMs,
    }),
  logFacts: routeFacts,
  run: jobRoute,
};
