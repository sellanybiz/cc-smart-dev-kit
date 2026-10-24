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

/** The refusal the command would give for a draft's state in its file; null where it writes. */
export function refusalOf(answer: ProjectGatewayData, draft: GatewayDraft): null | string {
  return answer.refusals[draft.team ? "team" : "personal"][draft.state];
}

/**
 * The action's body for a draft, or why the form will not send it: nothing while the draft is
 * where the form started (the project's own choice — so a project whose address is another
 * gateway's, or cannot be read, offers nothing until a change is chosen), else the command's own
 * refusal for that file and state (`refusals`, from its planner), else a profile the router does
 * not have.
 */
export function gatewayRequest(answer: ProjectGatewayData, draft: GatewayDraft): GatewayRequest {
  const body: GatewayDraft = { ...draft, profile: draft.state === "on" ? draft.profile : null };
  const start = gatewayDraftOf(answer);
  if (body.state === start.state && body.team === start.team && body.profile === start.profile) {
    return { kind: "same" };
  }
  const refused = refusalOf(answer, body);
  if (refused !== null) return { kind: "blocked", why: refused };
  if (body.state === "on" && body.profile !== null && !answer.profiles.includes(body.profile)) {
    return {
      kind: "blocked",
      why: `The router has no profile "${body.profile}": choose one it has, or none.`,
    };
  }
  return { body, kind: "send" };
}

/**
 * What reaches a Claude Code session already running (P7, re-proved on 2.1.310 for a file that
 * existed when the session started): a changed address within about a second; a removed one
 * falls to the next settings file that still sets it, also within seconds, and a session keeps
 * its last address only when no file sets it. The page cannot know which of the two a project
 * is in, so default says both. A file the session did not see at its start is not proved to
 * reach it, so the words say to restart then, as the command does.
 */
export function runningWords(state: GatewayChoice): string {
  return state === "default"
    ? "Default removes the address. A session already running in this project follows by itself, within a few seconds, to the next settings file that sets it (the machine's, say); only when no file sets it does the session keep the address it had until it restarts."
    : "A session already running in this project switches within about a second; restart it if the file did not exist when it started.";
}

/** Where the personal file's words come from: git tracking it makes it committed, whatever its name. */
export function personalFileWords(answer: ProjectGatewayData): string {
  return answer.personalTracked === true
    ? "Only you, by its name: .claude/settings.local.json in the main checkout. But git tracks it in this project, so what is written there is committed with it."
    : "Only you: .claude/settings.local.json in the main checkout, never committed. Every worktree of the project reads it first; a worktree's own copy of the file sets only what this one does not.";
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
