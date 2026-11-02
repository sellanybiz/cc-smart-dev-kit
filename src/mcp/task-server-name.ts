/**
 * The kit's task server's name (D75), in a module of its own. `names.ts` reaches the router's
 * bundle, and Bun keeps a name built from `COMMAND` there even when the router never uses it
 * (a template literal with an expression is kept), so it would change `plugin/dist/router.js`
 * and restart every machine's router (`.claude/rules/bundles-and-releases.md`).
 */

import { COMMAND } from "../build-info/names";

/** The kit's task server, as setup registers it and every session sees it. */
export const TASKS_SERVER_NAME = `${COMMAND}-tasks`;
