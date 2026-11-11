import { claudeFamily, claudeVersion, familyLabel, parseTarget } from "./targets";

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
