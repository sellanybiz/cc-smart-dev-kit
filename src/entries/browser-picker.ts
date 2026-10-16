/**
 * The bundle of the Playwright MCP's init page (`src/browser/picker.ts`), built to
 * `plugin/dist/browser-picker.js`. The launcher writes it beside the shared profile
 * (`cliPaths().browserPickerFile`) and passes that path as the MCP's `--init-page`: a path
 * inside the plugin's version folder would be deleted by an update while a session's MCP
 * is still running, and the MCP loads the file again for every tab.
 */
export { default } from "../browser/picker";
