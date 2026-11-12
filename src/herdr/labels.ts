export const KIT_LEAD = "kit.lead";
export const KIT_REPO = "kit.repo";
export const KIT_TASK = "kit.task";
export const KIT_INDEPENDENT = "kit.independent";
export const KIT_STARTED_BY = "kit.started-by";
export const KIT_LABELS = {
  lead: KIT_LEAD,
  repo: KIT_REPO,
  task: KIT_TASK,
  independent: KIT_INDEPENDENT,
  startedBy: KIT_STARTED_BY,
} as const;
export function leadId(core: string, address: string): string {
  return `${core}/${address}`;
}
export function parseLeadId(value: string): { core: string; address: string } | null {
  const parts = value.split("/");
  return parts.length === 2 && parts[0] && parts[1] ? { core: parts[0], address: parts[1] } : null;
}
export const HERDR_AGENT_PREFIX = "herdr:";
export function herdrAgent(core: string, address: string): string {
  return HERDR_AGENT_PREFIX + leadId(core, address);
}
export function isHerdrAgent(value: string): boolean {
  return (
    value.startsWith(HERDR_AGENT_PREFIX) &&
    parseLeadId(value.slice(HERDR_AGENT_PREFIX.length)) !== null
  );
}
export const REPORT_TAG = "kit-report";
export function escapeReport(text: string, from = "child"): string {
  const source = from
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const escaped = text.replace(
    new RegExp(`<(?:/?hc|/?${REPORT_TAG})`, "gi"),
    (match) => `&lt;${match.slice(1)}`,
  );
  return `<${REPORT_TAG} from="${source}">${escaped}</${REPORT_TAG}>`;
}
export const CHILD_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
export function validChildName(name: string): boolean {
  return CHILD_NAME_PATTERN.test(name);
}
export function childTerminalName(n: number | string): string {
  return `kit-${n}`;
}
export function childWorktreeName(n: number | string): string {
  return childTerminalName(n);
}
