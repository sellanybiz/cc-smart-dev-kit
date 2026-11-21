import type { HookSpec } from "../run";
import { sessionName } from "../session-name";

export const sessionNameHook: HookSpec = {
  name: "session-name",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit session-name: ${message}` }),
  run: sessionName,
};
