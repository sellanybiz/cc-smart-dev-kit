/**
 * The `herdr start --plan` line the kit suggests, in one home. It names its own placeholders:
 * the command refuses a start without a model, an effort, a mode and a brief. Light on purpose
 * (the command's name and the shell quoter), so a hook can print it without carrying the herdr
 * command.
 */
import { COMMAND } from "../build-info/names";
import { shellWord } from "../shell/quote";

/**
 * The resume or relaunch line for a plan's child, ready for the lead to fill in. `ref` is a slug
 * or `#n` (both resolve, `planByRef`); it is one shell word, so a `#` is quoted rather than read
 * as a comment, and a slug with a space stays whole.
 */
export function planStartCommand(ref: string): string {
  return `${COMMAND} herdr start --plan ${shellWord(ref)} --model <model> --effort <effort> --mode <mode> -- "<brief>"`;
}
