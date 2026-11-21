import { existsSync } from "node:fs";
import { readUserJson } from "../setup/user-json";

/**
 * What a reader of `cc-smart-dev-kit.json` needs without the parser: where the file sits, the
 * error classes, and the one field read on its own. No zod: the hook frame and the hooks that
 * stay light import this file (and `locate.ts`) directly, and `config.ts` re-exports every name
 * here, so its other importers do not change (`docs/design/hooks.md` § What a hook bundle
 * carries).
 */

/** Where the project's file sits inside a checkout and inside a commit. */
export const CONFIG_PATH = ".claude/cc-smart-dev-kit.json";

/** A cc-smart-dev-kit.json that exists but cannot be used. The message names the file and the field. */
export class CcSmartDevKitConfigError extends Error {
  override name = "CcSmartDevKitConfigError";
}

/** The project needs a newer (or other) version of the plugin than the one running. */
export class CcSmartDevKitVersionError extends CcSmartDevKitConfigError {
  override name = "CcSmartDevKitVersionError";
}

/**
 * The file still sets a retired worktree engine field (`RETIRED_WORKTREE_FIELDS`). A config
 * error like any other to every reader; its own class only so the portal's Project card can
 * still offer its write, which takes the field out (`src/portal/facts.ts` › `readProject`).
 */
export class CcSmartDevKitRetiredFieldError extends CcSmartDevKitConfigError {
  override name = "CcSmartDevKitRetiredFieldError";
}

/**
 * The names `ownHooks` lists in one cc-smart-dev-kit.json, read on their own, the way `requires` is:
 * a hook the project runs as its own copy stays silent even when the rest of the file needs
 * a newer plugin or is broken, so the person never gets two questions for one command.
 * Null when the file does not exist; empty when it cannot be read or lists nothing.
 */
export function readOwnHooks(file: string): string[] | null {
  if (!existsSync(file)) return null;
  try {
    // The one reader of a person-edited JSON file: an editor's byte order mark is skipped,
    // so a file Claude Code reads without trouble is not refused here (F5-2).
    const raw: unknown = readUserJson(file);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const listed = (raw as { ownHooks?: unknown }).ownHooks;
    return Array.isArray(listed)
      ? listed.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
}
