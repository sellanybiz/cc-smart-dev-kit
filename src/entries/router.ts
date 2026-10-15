// The router as its own bundle, plugin/dist/router.js. `anymodel gateway setup` copies it
// to ~/.local/share/anymodel/router.js, and the systemd user unit runs that copy: never this
// file, whose version folder Claude Code deletes some time after an update.
import { cliPaths } from "../cli/paths";
import { startRouter } from "../gateway/router";

startRouter(cliPaths().gatewayConfigFile);
