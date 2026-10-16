// The router as its own bundle, plugin/dist/router.js. `cc-smart-dev-kit gateway setup` copies it
// to ~/.local/share/cc-smart-dev-kit/router.js, and the systemd user unit runs that copy: never this
// file, whose version folder Claude Code deletes some time after an update.
//
// It imports build-info's `bun` and `names`, never its index: that bakes in the version.
// Its paths come from gateway/paths.ts, never from cli/paths.ts: this bundle must change
// only when the router does (`.claude/rules/bundles-and-releases.md`).
import { bunTooOld } from "../build-info/bun";
import { COMMAND } from "../build-info/names";
import { routerPaths } from "../gateway/paths";
import { startRouter } from "../gateway/router";

// An older Bun would send a backend's key through a proxy from the environment: the
// router does not start there. systemd stops trying after 5 failed starts in 60 s
// (`StartLimitBurst` in gateway/service.ts), so an upgraded Bun does not bring the router
// back by itself: `gateway setup` does. It clears the start limit (`systemctl --user
// reset-failed`) and starts the socket and the unit again, with the new Bun's path.
const tooOld = bunTooOld(Bun.version, process.execPath);
if (tooOld === null) {
  await startRouter(routerPaths());
} else {
  console.error(
    `cc-smart-dev-kit-router: ${tooOld} Upgrade this Bun, then run: ${COMMAND} gateway setup (systemd gives up after 5 failed starts, so an upgrade alone is not enough: it clears that limit with reset-failed and starts the router again)`,
  );
  process.exitCode = 1;
}
