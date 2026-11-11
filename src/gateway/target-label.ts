/** A target's short model name, without its backend or provider path. */
export function shortTargetName(target: string): string {
  const model = target.slice(target.indexOf(":") + 1);
  return model.slice(model.lastIndexOf("/") + 1);
}
