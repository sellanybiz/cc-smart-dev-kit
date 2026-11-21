import { fableSession } from "../fable-session";
import type { HookSpec } from "../run";

/**
 * The Fable-session note: SessionStart, PostModelSwitch and Stop. **Machine-wide** like
 * `agent-guard`: it runs with or without cc-smart-dev-kit.json, and its answer never depends on
 * the project's file — it is about the model this session runs on (§ `fable-session.ts`). Its
 * SessionStart entry carries **no matcher**, so every source is judged, a `fork` included, as
 * `update-check`'s does. It says one line to the person, once in a session, and nothing to
 * Claude: never an error and never a block, so a project that runs its own copy silences it
 * through `ownHooks` like any other plugin hook.
 *
 * **Not UserPromptSubmit** (a live bug, 2026-10-17): the model read there is the transcript's
 * last answer — the PREVIOUS turn's model — so it missed the switch to Fable and then warned
 * while the person was back on Opus. PostModelSwitch names the model the session moved TO
 * (`to_model`), and Stop judges the answer that just finished. See `fable-session.ts`.
 */
export const fableSessionHook: HookSpec = {
  name: "fable-session",
  events: ["SessionStart", "PostModelSwitch", "Stop"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    fableSession(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => fableSession(input, context.env, context.paths),
  run: ({ input, env, paths }) => fableSession(input, env, paths),
};
