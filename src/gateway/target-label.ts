import { claudeFamily, claudeVersion, familyLabel, parseTarget } from "./targets";

/** Server-tool routes are side queries, not a change of answering model. Shared with SQL. */
export const SERVER_TOOL_TARGET_PREFIXES = [
  "anthropic (server tool ",
  "router (server tool ",
] as const;

/** The history target for a server tool, whether Claude answered or the router supplied a note. */
export function serverToolTarget(tool: string, routerStatus?: number | null): string {
  return routerStatus === undefined
    ? `${SERVER_TOOL_TARGET_PREFIXES[0]}${tool})`
    : `${SERVER_TOOL_TARGET_PREFIXES[1]}${tool}; anthropic ${routerStatus ?? "did not answer"})`;
}

/** The answering model's short label, using the same family and version readers as routing. */
export function answerTargetName(target: string): string | null {
  if ("error" in parseTarget(target)) return null;
  const family = claudeFamily(target);
  const version = claudeVersion(target);
  return family === null || version === null
    ? shortTargetName(target)
    : `${familyLabel(family)} ${version.major}.${version.minor}`;
}

/** A target's short model name, without its backend or provider path. */
export function shortTargetName(target: string): string {
  const model = target.slice(target.indexOf(":") + 1);
  return model.slice(model.lastIndexOf("/") + 1);
}
