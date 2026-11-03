import type { PortalContext } from "../context";
import { forgetAgentLists } from "./agents-read";

/** Drops this portal's kept agent lists after an action. */
export function forgetPageReads(ctx: PortalContext): void {
  forgetAgentLists(ctx);
}
