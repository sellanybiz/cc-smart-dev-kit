// The Playwright output hook: plugin/dist/playwright-output.js, on PreToolUse for
// `mcp__playwright__*` (plugin/hooks/hooks.json). It puts a caller-named screenshot in the
// shared browser's output folder instead of the folder the session runs in
// (`src/hooks/playwright-output.ts`). A USER_HOOKS bundle: it never enters the frame and reads
// no cc-smart-dev-kit.json — it is about the machine's shared browser, not a project.
import { playwrightOutput } from "../hooks/playwright-output";

await playwrightOutput();
