/**
 * The Gateway card's rules (GP4b), apart from its drawing: what a state's tone is, where the
 * change form starts, what it may send, what reaches a running session, and what applies to a
 * profile's slot. The command line makes every refusal again; these only keep the page from
 * offering what it would refuse, and say why in its words.
 */

import type { ProjectGatewayData, ProjectGatewayStateName, ProjectProfileSlot } from "@/api/types";
import type { Tone } from "@/components/status";

/** The three states a project may be given (`gateway project on|off|default`). */
export type GatewayChoice = "default" | "off" | "on";

/** What the change form holds: the state, the file it goes to, and the profile with on. */
export interface GatewayDraft {
  profile: null | string;
  state: GatewayChoice;
  /** True for the team file (`.claude/settings.json`), false for the personal one. */
  team: boolean;
}

/** The tone a state is drawn in: always with its words, never colour alone. */
export function stateTone(state: ProjectGatewayStateName): Tone {
  if (state === "on") return "ok";
  if (state === "other") return "warn";
  if (state === "unknown") return "bad";
  return "info";
}

/** A state's short name, as the card's pill says it. */
export const STATE_LABEL: Readonly<Record<ProjectGatewayStateName, string>> = {
  default: "Default",
  off: "Off",
  on: "On",
  other: "Another address",
  unknown: "Unknown",
};

/**
 * Where the form starts: the project's own choice, in the file that holds it. Another address,
 * or one that cannot be read, is nobody's choice the form can keep, so it starts at default.
 */
export function gatewayDraftOf(answer: ProjectGatewayData): GatewayDraft {
  const { choice } = answer;
  const state: GatewayChoice =
    choice.state === "on" || choice.state === "off" ? choice.state : "default";
  return {
    profile: state === "on" ? choice.profile : null,
    state,
    team: choice.source === "team",
  };
}

/** What the form may do with a draft: nothing (it is the choice now), refuse it, or send it. */
export type GatewayRequest =
  | { kind: "same" }
  | { kind: "blocked"; why: string }
  | { kind: "send"; body: GatewayDraft };

/**
 * The action's body for a draft, or why the form will not send it. The same refusals the
 * command makes before it writes (`planProjectChange`), in the page's words: a team file never
 * points teammates at one person's router, on needs the gateway and an untracked personal file,
 * and a profile must be one the router has.
 */
export function gatewayRequest(answer: ProjectGatewayData, draft: GatewayDraft): GatewayRequest {
  const body: GatewayDraft = { ...draft, profile: draft.state === "on" ? draft.profile : null };
  const now = gatewayDraftOf(answer);
  if (
    answer.choice.state === now.state &&
    body.state === now.state &&
    body.team === now.team &&
    body.profile === now.profile
  ) {
    return { kind: "same" };
  }
  if (!answer.writable) {
    return {
      kind: "blocked",
      why: "This folder is not in a git project: nothing can be written here.",
    };
  }
  if (body.state === "on") {
    if (body.team) {
      return {
        kind: "blocked",
        why: "The team file takes off or default only: it never points teammates at your own router.",
      };
    }
    if (!answer.configured) {
      return {
        kind: "blocked",
        why: "On needs this machine's gateway: set it up on Machine first.",
      };
    }
    if (!answer.onAllowed) {
      return {
        kind: "blocked",
        why: "On is refused while git tracks the personal file: the note above says how to untrack it.",
      };
    }
    if (body.profile !== null && !answer.profiles.includes(body.profile)) {
      return {
        kind: "blocked",
        why: `The router has no profile "${body.profile}": choose one it has, or none.`,
      };
    }
  }
  return { body, kind: "send" };
}

/**
 * What reaches a Claude Code session already running (GP0's P7): a changed address within about
 * a second, a removed one never — so default, which removes the key, waits for a restart.
 */
export function runningWords(state: GatewayChoice): string {
  return state === "default"
    ? "Default removes the address, and a running session never sees a removal: restart a session already running in this project."
    : "A session already running in this project switches within about a second.";
}

/**
 * What answers a profile's slot: its own chain, plain Claude in the profile, or the machine's
 * chain (null there: Claude answers it on the machine too).
 */
export function slotApplies(slot: ProjectProfileSlot): {
  chain: null | string[];
  from: "claude" | "machine" | "own";
} {
  if (slot.own === "claude") return { chain: null, from: "claude" };
  if (slot.own !== null) return { chain: slot.own, from: "own" };
  return { chain: slot.machine, from: "machine" };
}
