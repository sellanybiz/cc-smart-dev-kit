import { buildInfo } from "./manifest" with { type: "macro" };
import { PLUGIN_ID } from "./names";

// The fixed names live in ./names (no macro), so a bundle that needs only them, the
// router, does not change with the version. Everything else imports them from here.
export { bunTooOld, MIN_BUN } from "./bun";
export { COMMAND, MARKETPLACE, PLUGIN, PLUGIN_ID } from "./names";

// A Bun macro: it runs when this file is transpiled (by the bundler, or by `bun` running src),
// so dist/cli.js holds these two values only, never the rest of plugin.json.
const info = buildInfo();

/** The plugin version this code was built from. */
export const VERSION: string = info.version;
/** Where the marketplace lives, as `<owner>/<name>`: plugin.json's `repository`. */
export const MARKETPLACE_SOURCE: string = info.repo;

/** The commands a user runs to add, install and update the plugin. */
export const MARKETPLACE_ADD_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
export const PLUGIN_INSTALL_COMMAND = `claude plugin install ${PLUGIN_ID}`;
export const PLUGIN_UPDATE_COMMAND = `claude plugin update ${PLUGIN_ID}`;
