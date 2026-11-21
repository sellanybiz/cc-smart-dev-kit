import { parserFingerprint } from "../build-info/parser-fingerprint" with { type: "macro" };
import { type CcSmartDevKitConfig, parseCcSmartDevKitConfig } from "../project/config";
import { CcSmartDevKitConfigError } from "../project/config-facts";

/**
 * The sibling bundle `plugin/dist/config-check.js`: the project file's parser, kept out of every
 * hook bundle. A hook reads the file's bytes, looks them up in its cache, and loads this bundle
 * only on a miss (`src/hooks/checked-config.ts`), so a warm hook loads no zod and no schemas.
 * It has no side effects when loaded: it exports two names and runs nothing.
 *
 * It answers with plain data, never an error: `instanceof` does not work across two bundles, so
 * a config error becomes `{ ok: false, message }` here and the hook says it with the same words
 * (`parseCcSmartDevKitConfig`'s messages, byte for byte). Any other error is rethrown: a bug in
 * the parser stays a crash in the hook, as it does today.
 */

/** The parser's build fingerprint, baked in at build time (`src/build-info/parser-fingerprint.ts`). */
export const FINGERPRINT: string = parserFingerprint();

/** What the sibling answers: the parsed file, or the config problem's words. */
export type CheckAnswer =
  | { ok: true; value: CcSmartDevKitConfig; fingerprint: string }
  | { ok: false; message: string; fingerprint: string };

/**
 * Parses the bytes the hook already read, as `parseCcSmartDevKitConfig` does: `where` names the
 * file in every message. The answer carries this bundle's own fingerprint, so a hook that
 * loaded a sibling from another build can tell, and never caches what it said.
 */
export function checkProjectText(text: string, where: string): CheckAnswer {
  try {
    return { ok: true, value: parseCcSmartDevKitConfig(text, where), fingerprint: FINGERPRINT };
  } catch (error) {
    if (error instanceof CcSmartDevKitConfigError) {
      return { ok: false, message: error.message, fingerprint: FINGERPRINT };
    }
    throw error;
  }
}
