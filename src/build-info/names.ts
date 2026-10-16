// The plugin's fixed names, with no build-time macro. The router bundle imports these from
// here, not from `./index`: that file bakes in the version, so `plugin/dist/router.js` would
// change with every version bump, and every machine would restart its router for nothing.

/** The marketplace and plugin names, as Claude Code records them: `cc-smart-dev-kit@cc-smart-dev-kit`. */
export const MARKETPLACE = "cc-smart-dev-kit";
export const PLUGIN = "cc-smart-dev-kit";
export const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;

/** The command this plugin installs (the launcher in ~/.local/bin, and plugin/bin). */
export const COMMAND = "cc-smart-dev-kit";
