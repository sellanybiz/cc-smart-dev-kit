/**
 * `gateway setup`'s questions, asked one at a time on a terminal (`src/cli/ui/prompt.ts`):
 * OmniRoute's address and its API key (the secret read: never shown, never printed). Every
 * question comes first; `commandSetup` makes the changes after, so a run stopped at a question
 * changes nothing.
 *
 * - **No slot is asked, and no model is offered** (D66, the owner): every slot is Claude by
 *   default, and a person gives a slot a chain with `gateway slot` (or the portal's Slots page)
 *   when they want one. Setup puts the router, OmniRoute's address and its key in place, and
 *   leaves every chain as it is.
 * - **The gateway is not turned on here either**: it is off by default, and `gateway on` is the
 *   person's own step.
 * - **The judge is never asked.** It is Claude first (D44); a judge chain of its own needs the
 *   judge test first, and `gateway slot judge` runs it.
 * - **The API key, not the dashboard password.** A key made from the password exists only after
 *   the port check. `--omniroute-password` stays the way to make one.
 *
 * Every fact comes in as an argument (`SetupFacts`), so this module imports nothing from
 * `commands.ts` (which imports it), and a test drives it with fake prompts.
 */
import type { Prompts } from "../cli/ui/prompt";

/** OmniRoute as the router reaches it: its address and the key the router sends. */
export interface SetupBackend {
  apiKey: string;
  baseUrl: string;
}

export interface SetupFacts {
  /** Its name in a question (`OmniRoute`). */
  label: string;
  /** Its address and key in the config now; null when it has none yet. */
  saved: null | SetupBackend;
  /** True when a config is there (maybe with no key for this backend, written by hand). */
  hasConfig: boolean;
  /** The address to offer when nothing is saved. */
  defaultBaseUrl: string;
  /** The flags that give a key with no question: named when the key cannot be read here. */
  keyFlags: string;
  print(line: string): void;
}

export interface SetupAnswers {
  /** The address answered, with no trailing `/`. */
  baseUrl: string;
  /** The key typed; null when Enter kept the saved one. */
  key: null | string;
}

export type SetupQuestions = { answers: SetupAnswers } | { error: string } | { stopped: true };

/** The intro line, said once before the first question. */
export const SETUP_QUESTIONS_INTRO = "Enter keeps the answer in [brackets].";

/** Why `text` is not an address the router can reach; null when it is. */
export function addressProblem(text: string): null | string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "give a full address, such as http://127.0.0.1:20128";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "the address starts with http:// or https://";
  }
  // Output never shows a credential in an address, and a question shows its answer.
  return url.username === "" && url.password === ""
    ? null
    : "give the address with no user or password in it";
}

export async function askSetupQuestions(
  prompts: Prompts,
  facts: SetupFacts,
): Promise<SetupQuestions> {
  facts.print(SETUP_QUESTIONS_INTRO);
  const savedUrl = facts.saved?.baseUrl;
  // A saved address with a user or password in it would be shown as the question's default:
  // it is kept as it is, and not asked.
  const keepsAddress = savedUrl !== undefined && addressProblem(savedUrl) !== null;
  if (keepsAddress) {
    facts.print(
      `· ${facts.label}'s address is kept as it is: it holds a user or password, so it is not shown`,
    );
  }
  const baseUrl = keepsAddress
    ? savedUrl
    : prompts
        .ask(`${facts.label}'s address`, {
          default: savedUrl ?? facts.defaultBaseUrl,
          check: addressProblem,
        })
        .replace(/\/+$/, "");

  // A terminal that cannot hide what is typed is never asked for the key: a saved one stays.
  if (prompts.secret === null && facts.saved === null) {
    return {
      error: `this terminal cannot hide what you type, so the key would be shown on screen. Give it on stdin instead: ${facts.keyFlags}`,
    };
  }
  if (prompts.secret === null) {
    facts.print(
      `· this terminal cannot hide what you type, so the key is not asked: the saved one stays (to change it: ${facts.keyFlags})`,
    );
  }
  const typed =
    prompts.secret === null
      ? ""
      : await prompts.secret(
          facts.saved === null
            ? `${facts.label}'s API key for the router`
            : `${facts.label}'s API key for the router (Enter keeps the saved one)`,
        );
  if (typed === null) return { stopped: true };
  const key = typed.trim() === "" ? null : typed.trim();
  const apiKey = key ?? facts.saved?.apiKey;
  if (apiKey === undefined && facts.hasConfig) {
    // A config with no key for this backend (written by hand): setup still puts the router
    // in place, as it did before it asked, and changes nothing in the config.
    facts.print(`· no ${facts.label} API key was given: the config stays as it is`);
    return { answers: { baseUrl, key: null } };
  }
  if (apiKey === undefined) {
    return { error: `no ${facts.label} API key was given. Give one: ${facts.keyFlags}` };
  }
  return { answers: { baseUrl, key } };
}
