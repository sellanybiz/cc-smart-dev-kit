/**
 * What a hook or a status line reads about the session it runs in: the tools that launch an
 * agent, the model the session itself runs on (`sessionModelOf`), and the gateway it runs
 * behind (`sessionGatewayOf`). Machine facts, never the project's file. The launch judge that
 * used these (the `agent-guard` hook, and the Bash judge in `job-route`) is gone (5.7.0); the
 * session-start notes (`fable-session`, `tier-view`), `keep-going` and the status lines still
 * read them.
 */
import type { CliPaths } from "../cli/paths";
import {
  type GatewayConfig,
  loadConfigFile,
  plainClaudeView,
  profileView,
} from "../gateway/config";
import { urlMeaning } from "../gateway/project-state";
import { baseUrlPointsAtGateway, routerBaseUrl } from "../gateway/settings";
import type { GatewayFacts, SessionModel } from "../models/launch-policy";
import { type HookInput, stringField } from "./io";
import type { Env } from "./run";
import { lastClaudeModel } from "./transcript";

/** The tools that launch an agent: the Agent tool, its older name, and Workflow. */
export const AGENT_TOOLS = ["Agent", "Task"] as const;
export const WORKFLOW_TOOLS = ["Workflow"] as const;

/** The gateway config for a hook on this machine: null when there is none, or it cannot be used. */
export function gatewayConfigOf(paths: CliPaths): GatewayConfig | null {
  try {
    return loadConfigFile(paths.gatewayConfigFile);
  } catch {
    // No gateway.json, or one that cannot be used: no slot is known, and every claude-… id
    // stays Claude. The reading then leans on the family names alone.
    return null;
  }
}

/**
 * The model the session itself runs on: the one that last answered in its transcript
 * (`lastClaudeModel`, served), else the model it was started on (`ANTHROPIC_MODEL`, asked for).
 * One home: `fable-session` and the tier note both read it.
 */
export function sessionModelOf(input: HookInput, env: Env): null | SessionModel {
  const transcript = stringField(input.transcript_path);
  const answered = transcript === null ? null : lastClaudeModel(transcript);
  if (answered !== null) return { model: answered, served: true };
  const started = stringField(env.ANTHROPIC_MODEL);
  return started === null ? null : { model: started, served: false };
}

/** The gateway one session runs on: `GatewayFacts`, and the profile its URL names. */
export interface SessionGateway extends GatewayFacts {
  /** The profile the session's URL names (`…/p/<name>`); null for none. */
  profile: null | string;
}

/**
 * The gateway as THIS session runs on it (RF1-2). Claude Code gives a hook process the session's
 * effective `ANTHROPIC_BASE_URL` in its own environment — the project's personal file over its
 * team file over the user file, a `--settings` file over all of them, and any of them over the
 * shell's own export (proved live on 2.1.310, `docs/claude-code-contract.md` § Hooks) — so
 * `gateway project on|off`, a profile and `launch --settings` are each judged as the session
 * really runs, never from the machine's file alone:
 *   - no URL, or Anthropic's own address (what `gateway off` and `gateway project off` write):
 *     off, the Claude model answers on the person's login;
 *   - `…/p/<name>` on this machine's router: on, with that profile's chains (`profileView`); a
 *     name the config does not hold answers as plain Claude (`plainClaudeView`), as the router
 *     answers it;
 *   - this machine's router, or any other address: on, with the machine's chains, as before.
 * Never throws: a config that cannot be read gives no chains (`gatewayConfigOf`).
 */
export function sessionGatewayOf(paths: CliPaths, env: Env): SessionGateway {
  const raw = env.ANTHROPIC_BASE_URL;
  const url = raw === undefined || raw === "" ? null : raw;
  const config = gatewayConfigOf(paths);
  if (!baseUrlPointsAtGateway(url)) return { config, gatewayOn: false, profile: null };
  const profile = config === null ? null : urlMeaning(url, routerBaseUrl(config.port)).profile;
  if (config === null || profile === null) return { config, gatewayOn: true, profile: null };
  return {
    config: profileView(config, profile) ?? plainClaudeView(config),
    gatewayOn: true,
    profile,
  };
}
