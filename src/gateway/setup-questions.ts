/**
 * `gateway setup`'s questions, asked one at a time on a terminal (`src/cli/ui/prompt.ts`):
 * OmniRoute's address, its API key (the secret read: never shown, never printed), a chain for
 * each model slot picked from the live model list, and whether to turn the gateway on. Every
 * question comes first; `commandSetup` makes the changes after, so a run stopped at a question
 * changes nothing.
 *
 * - **Nothing is picked for the person.** Each slot's default is the chain it has now, or "off"
 *   when it has none: Enter never sets a model, and never wipes a chain.
 * - **The judge is not asked.** It is Claude first, with the worker's tested targets standing in
 *   while Claude cannot (D44); a judge chain of its own needs the judge test first, and
 *   `gateway slot judge` runs it.
 * - **The API key, not the dashboard password.** The model list needs a key before any change,
 *   and a key made from the password exists only after the port check. `--omniroute-password`
 *   stays the way to make one.
 *
 * Every fact comes in as an argument (`SetupFacts`), so this module imports nothing from
 * `commands.ts` (which imports it), and a test drives it with fake prompts and a fake list.
 */
import type { Prompts } from "../cli/ui/prompt";

/** One slot the questions ask about. */
export interface SetupSlot {
  /** The slot's key in the config (`cc-smart-dev-kit-scout`). */
  key: string;
  /** Its short name (`scout`). */
  name: string;
  /** The Claude family whose work it answers (`haiku`). */
  family: string;
  /** Its chain in use now; empty when it is Claude. */
  chain: readonly string[];
}

/** OmniRoute as the router reaches it: its address and the key the router sends. */
export interface SetupBackend {
  apiKey: string;
  baseUrl: string;
}

export interface SetupFacts {
  /** The backend that `setup` writes the address and key of (`omniroute`). */
  backend: string;
  /** Its name in a question (`OmniRoute`). */
  label: string;
  /** Its address and key in the config now; null when it has none yet. */
  saved: null | SetupBackend;
  /** The address to offer when nothing is saved. */
  defaultBaseUrl: string;
  /** The slots, in the order they are asked. */
  slots: readonly SetupSlot[];
  /** The words that make a slot Claude (`claude`, `off`); `off` is the one a question offers. */
  claudeWords: readonly string[];
  /** The backend's model ids, or why they could not be read. */
  listModels(backend: SetupBackend): Promise<{ ids: string[] } | { reason: string }>;
  /** Why `text` is not a chain `slot` can take with these model ids; null when it can. */
  checkChain(slot: string, text: string, ids: string[], backend: SetupBackend): null | string;
  /** True when Claude Code already uses the gateway: the turn-on question is not asked. */
  gatewayOn: boolean;
  /** The flags that give a key with no question: named when the key cannot be read here. */
  keyFlags: string;
  /** The commands that pick a slot's chain later: named when the list cannot be read. */
  pickLater: string;
  print(line: string): void;
}

export interface SetupAnswers {
  /** The address answered, with no trailing `/`. */
  baseUrl: string;
  /** The key typed; null when Enter kept the saved one. */
  key: null | string;
  /** The model ids the chains were picked from. */
  ids: string[];
  /** Each slot whose chain changes, with its new chain (`omniroute:a,omniroute:b`) or `claude`. */
  chains: Record<string, string>;
  turnOn: boolean;
}

export type SetupQuestions = { answers: SetupAnswers } | { error: string } | { stopped: true };

/** The word a slot question offers for "no chain": the slot stays (or becomes) Claude. */
const OFF = "off";

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
  return url.protocol === "http:" || url.protocol === "https:"
    ? null
    : "the address starts with http:// or https://";
}

/**
 * A slot's answer with each number replaced by the model it stands for (`2` → `omniroute:m2`);
 * the problem in words for a number that is not on the list. A slot word (`off`) stays.
 */
export function resolvePicks(
  answer: string,
  ids: readonly string[],
  backend: string,
): { error: string } | { text: string } {
  const parts = answer
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      resolved.push(part);
      continue;
    }
    const id = ids[Number(part) - 1];
    if (id === undefined) {
      return { error: `there is no model ${part} on the list (1 to ${String(ids.length)})` };
    }
    resolved.push(`${backend}:${id}`);
  }
  return { text: resolved.join(",") };
}

export async function askSetupQuestions(
  prompts: Prompts,
  facts: SetupFacts,
): Promise<SetupQuestions> {
  facts.print(SETUP_QUESTIONS_INTRO);
  const baseUrl = prompts
    .ask(`${facts.label}'s address`, {
      default: facts.saved?.baseUrl ?? facts.defaultBaseUrl,
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
  if (apiKey === undefined) {
    return { error: `no ${facts.label} API key was given. Give one: ${facts.keyFlags}` };
  }
  const backend: SetupBackend = { apiKey, baseUrl };

  const chains: Record<string, string> = {};
  const listed = await facts.listModels(backend);
  const ids = "ids" in listed ? listed.ids : [];
  if ("reason" in listed || ids.length === 0) {
    const why = "reason" in listed ? listed.reason : "it lists no model";
    facts.print(
      `! ${facts.label}'s model list could not be read (${why}), so every slot stays as it is. Pick them later: ${facts.pickLater}.`,
    );
  } else {
    facts.print(`${facts.label}'s models:`);
    ids.forEach((id, index) => {
      facts.print(`  ${String(index + 1)}. ${facts.backend}:${id}`);
    });
    for (const slot of facts.slots) {
      const now = slot.chain.join(",");
      const isClaude = (text: string) => facts.claudeWords.includes(text);
      const answer = prompts.ask(
        `The ${slot.name} slot (${capitalized(slot.family)}'s work): numbers or targets, comma-separated, or "${OFF}"`,
        {
          default: now === "" ? OFF : now,
          check: (text) => {
            const picked = resolvePicks(text, ids, facts.backend);
            if ("error" in picked) return picked.error;
            // A slot that is Claude already stays Claude: nothing to check, nothing to change.
            if (isClaude(picked.text) && slot.chain.length === 0) return null;
            return facts.checkChain(slot.key, picked.text, ids, backend);
          },
        },
      );
      const picked = resolvePicks(answer, ids, facts.backend);
      // The default is never checked; a default made of numbers cannot happen (it is a chain).
      if ("error" in picked) continue;
      if (isClaude(picked.text)) {
        if (slot.chain.length > 0) chains[slot.key] = picked.text;
      } else if (picked.text !== now) {
        chains[slot.key] = picked.text;
      }
    }
  }

  const turnOn =
    !facts.gatewayOn &&
    prompts.confirm(
      "Turn the gateway on now? Every Claude Code session on this machine then sends its requests through it",
      false,
    );
  return { answers: { baseUrl, chains, ids, key, turnOn } };
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
