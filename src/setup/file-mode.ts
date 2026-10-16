/**
 * A file's permission bits, on every platform: setting them, and asking whether a file is its
 * owner's alone.
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
 * The same rule reads backwards, and that is `isOwnerOnly` below: every reader that refuses a
 * file the group or others can read (the browser's token, the gateway's config, the Tavily key
 * file, the browser's output folder) asks it, because the synthetic Windows mode would otherwise
 * refuse every file the plugin owns.
 *
 * Every mode call, and every "is this file the owner's alone?" answer, goes through here —
 * one home for both halves of that rule.
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

/**
 * Is this file its owner's alone? Off Windows the mode answers it: every bit for the group and
 * for others is clear (what `0600` and `0700` mean).
 *
 * **On Windows the mode answers nothing.** It is made up there — a writable file reports `0666`
 * and a read-only one `0444`, whatever its ACL says — so asking the bits would refuse every file
 * the plugin owns: the gateway would run on its fallback config, the browser's token would look
 * unreadable, the Tavily key file would be ignored. The ACL of the user profile is what protects
 * those files there (`docs/windows-setup.md` § File modes), so on Windows every file counts as
 * the owner's alone.
 *
 * `platform` is injectable, like `setFileMode`'s, so a Linux or macOS test exercises the Windows
 * answer.
 */
export function isOwnerOnly(mode: number, platform: NodeJS.Platform = hostPlatform()): boolean {
  return platform === "win32" || (mode & 0o077) === 0;
}
