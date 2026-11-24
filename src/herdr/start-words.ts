/**
 * The `herdr start --plan` line the kit suggests, in one home. It names its own placeholders:
 * the command refuses a start without a model, an effort, a mode and a brief. Light on purpose
 * (only the command's name), so a hook can print it without carrying the herdr command.
 */
import { COMMAND } from "../build-info/names";

/** The resume or relaunch command for a plan's child; the lead fills in the placeholders. */
export function planStartCommand(slug: string): string {
  return `${COMMAND} herdr start --plan ${slug} --model <model> --effort <effort> --mode <mode> -- "<brief>"`;
}
