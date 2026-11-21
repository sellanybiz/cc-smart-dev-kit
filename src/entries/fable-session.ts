// The fable-session hook: plugin/dist/fable-session.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { fableSessionHook } from "../hooks/specs/fable-session";

await runHookEntry(fableSessionHook);
