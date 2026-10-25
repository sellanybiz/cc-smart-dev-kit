/**
 * The page reads that start a heavy child and are kept for `PAGE_READ_FRESH_MS`
 * (`shortCache`, `cli-child.ts`): the agent list and the cleanup facts. One place to drop them,
 * for the two things that make them stale — an action that ran (`runAction`), and crew news the
 * live stream is about to publish (`createLiveSources`). The page reloads after either, and a
 * read kept from before it would show the old list until some unrelated event.
 */
import type { PortalContext } from "../context";
import { forgetAgentLists } from "./agents-read";
import { forgetCleanups } from "./cleanup-read";

/** Drops this portal's kept agent lists and cleanup answers. */
export function forgetPageReads(ctx: PortalContext): void {
  forgetAgentLists(ctx);
  forgetCleanups(ctx);
}
