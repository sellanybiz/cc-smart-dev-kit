// The router as its own bundle, plugin/dist/router.js. `anymodel gateway setup` copies it
// to ~/.local/share/anymodel/router.js, and the systemd user unit runs that copy: never this
// file, whose version folder Claude Code deletes some time after an update.
//
// It imports build-info's `bun` and `names`, never its index: that bakes in the version.
import { bunTooOld } from "../build-info/bun";
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { startRouter } from "../gateway/router";

// An older Bun would send a backend's key through a proxy from the environment: the
// router does not start there. The unit tries again every 2 s, so an upgrade in place
// brings it up; a Bun elsewhere needs `gateway setup`, which writes its path in the unit.
const tooOld = bunTooOld(Bun.version, process.execPath);
if (tooOld === null) {
  startRouter(cliPaths().gatewayConfigFile);
} else {
  console.error(`anymodel-router: ${tooOld} Upgrade this Bun, then run: ${COMMAND} gateway setup`);
  process.exitCode = 1;
}
