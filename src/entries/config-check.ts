import { parserFingerprint } from "../build-info/parser-fingerprint" with { type: "macro" };
import { type CcSmartDevKitConfig, parseCcSmartDevKitConfig } from "../project/config";
import { CcSmartDevKitConfigError } from "../project/config-facts";
import { parseWorkflowText, WorkflowConfigError } from "../workflow/resolve";
import type { PersonalWorkflow } from "../workflow/schema";

/**
 * The sibling bundle `plugin/dist/config-check.js`: the config files' parsers, kept out of every
 * hook bundle. A hook reads a file's bytes, looks them up in its cache, and loads this bundle
 * only on a miss (`src/hooks/checked-config.ts`), so a warm hook loads no zod and no schemas.
 * It has no side effects when loaded: it exports three names and runs nothing.
 *
 * It answers with plain data, never an error: `instanceof` does not work across two bundles, so
 * a config error becomes `{ ok: false, message }` here and the hook says it with the same words
 * (`parseCcSmartDevKitConfig`'s and `parseWorkflowText`'s messages, byte for byte). Any other
 * error is rethrown: a bug in a parser stays a crash in the hook, as it does today.
 */

/** The parser's build fingerprint, baked in at build time (`src/build-info/parser-fingerprint.ts`). */
export const FINGERPRINT: string = parserFingerprint();

/** What the sibling answers: the parsed file, or the config problem's words. */
export type Answer<T> =
  | { ok: true; value: T; fingerprint: string }
  | { ok: false; message: string; fingerprint: string };

/**
 * Runs one parser over the bytes the hook already read. The answer carries this bundle's own
 * fingerprint, so a hook that loaded a sibling from another build can tell, and never caches
 * what it said.
 */
function answerOf<T>(parse: () => T, isConfigError: (error: unknown) => error is Error): Answer<T> {
  try {
    return { ok: true, value: parse(), fingerprint: FINGERPRINT };
  } catch (error) {
    if (isConfigError(error)) {
      return { ok: false, message: error.message, fingerprint: FINGERPRINT };
    }
    throw error;
  }
}

/** Parses a project file's text, as `parseCcSmartDevKitConfig` does: `where` names the file. */
export function checkProjectText(text: string, where: string): Answer<CcSmartDevKitConfig> {
  return answerOf(
    () => parseCcSmartDevKitConfig(text, where),
    (error): error is CcSmartDevKitConfigError => error instanceof CcSmartDevKitConfigError,
  );
}

/** Parses the person's workflow file's text, as `parseWorkflowText` does: `where` names the file. */
export function checkWorkflowText(text: string, where: string): Answer<PersonalWorkflow> {
  return answerOf(
    () => parseWorkflowText(text, where),
    (error): error is WorkflowConfigError => error instanceof WorkflowConfigError,
  );
}
