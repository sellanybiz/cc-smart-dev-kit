/**
 * The sound an alert gets, one program per platform: what `alerts.sound` adds where the
 * platform has a sound (`src/workflow/schema.ts`), and what the desktop route already plays
 * on Linux through `notify.json`'s `desktopSound`.
 *
 * One home for the three platforms' programs, because two hooks play a sound: `notify`
 * (every alert) and `stop-failure` (the usage-limit alert). Nothing here decides *whether*
 * a sound is wanted — that is the settings' business (`alertsAt`, `readNotifyConfig`) — and
 * nothing here runs anything: each caller starts the argv its own way (the hooks never wait
 * for a sound).
 *
 * - **Linux**: the freedesktop sound theme's own file, through `paplay`, or the same sound
 *   by its event id through `canberra-gtk-play` when `paplay` is not installed. The names in
 *   `SOUND_DIR` are the event ids themselves (`dialog-warning` is both).
 * - **macOS**: a system sound under `/System/Library/Sounds`, through `afplay`.
 * - **Windows**: nothing. The toast itself carries the notification platform's default
 *   sound, which is the platform's own behaviour and not something this plugin adds to or
 *   takes away (`windowsToastArgv`). The terminal route over SSH has its own bell, added by
 *   the callers (`notify.ts`).
 */
import { join } from "node:path";

/** The freedesktop sounds the desktop route plays, by name, under this folder. */
export const SOUND_DIR = "/usr/share/sounds/freedesktop/stereo";

/** A freedesktop sound's name: which alert moment it belongs to. */
export type SoundName = "dialog-warning" | "service-login" | "service-logout";

/** The macOS system sound each moment plays: `/System/Library/Sounds/<name>.aiff`. */
export const MACOS_SOUNDS: Readonly<Record<SoundName, string>> = {
  "dialog-warning": "Basso",
  "service-login": "Glass",
  "service-logout": "Pop",
};

/** Finds a program on PATH (the real one: `Bun.which` with the hook's PATH). */
export type Which = (command: string) => null | string;

/**
 * The program that plays the sound of `moment` on `platform`, and its arguments — or null
 * when this machine has nothing to play it with (and on Windows, where the toast's own
 * sound is the platform's).
 */
export function soundArgv(
  moment: SoundName,
  platform: NodeJS.Platform,
  which: Which,
): null | string[] {
  if (platform === "linux") {
    const paplay = which("paplay");
    if (paplay !== null) return [paplay, join(SOUND_DIR, `${moment}.oga`)];
    const canberra = which("canberra-gtk-play");
    return canberra === null ? null : [canberra, "-i", moment];
  }
  if (platform === "darwin") {
    const afplay = which("afplay");
    return afplay === null
      ? null
      : [afplay, join("/System/Library/Sounds", `${MACOS_SOUNDS[moment]}.aiff`)];
  }
  return null;
}
