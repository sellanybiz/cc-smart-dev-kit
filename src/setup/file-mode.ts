/**
 * Setting a file's permission bits, on every platform.
 *
 * On Linux and macOS a mode is what protects a file: 0600 for a key, 0700 for the folder
 * that holds the backups, 0755 for the launcher, and a failure to set it is worth stopping
 * for — the file would be readable by others.
 *
 * **On Windows a mode is not protection at all.** `chmod` there only toggles the read-only
 * attribute: there is no user/group/other and no execute bit, and `fchmod` (on a handle) is
 * not implemented at all. What protects a file on Windows is the ACL of the user profile it
 * lives in — every path the plugin owns sits under `%USERPROFILE%`, which other accounts
 * cannot read (`docs/windows-setup.md`). So a mode call that fails on Windows must never end
 * the run: the content is written and correct, and only the (already ACL-protected) bits are
 * different. On Linux and macOS the failure is thrown, exactly as before.
 *
 * Every mode call in `src/setup/` goes through here — one home for that rule.
 */
import { chmodSync, fchmodSync } from "node:fs";
import { hostPlatform } from "../machine/host";

/** Thrown to the caller on Linux and macOS; on Windows the file's ACL is the protection. */
function failureIsFatal(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

/**
 * Sets the mode of `file`, or of an open file descriptor (`fchmod`, which Windows does not
 * implement). `platform` is injectable so a Linux or macOS test can exercise the Windows
 * path (`hostPlatform` reads the same variable `Machine` does).
 */
export function setFileMode(
  fileOrFd: number | string,
  mode: number,
  platform: NodeJS.Platform = hostPlatform(),
): void {
  try {
    if (typeof fileOrFd === "number") fchmodSync(fileOrFd, mode);
    else chmodSync(fileOrFd, mode);
  } catch (error) {
    if (failureIsFatal(platform)) throw error;
  }
}
