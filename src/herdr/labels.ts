export const KIT_LEAD = "kit.lead";
export const KIT_REPO = "kit.repo";
export const KIT_TASK = "kit.task";
/** A plan child carries the plan's slug: it builds that plan only and never coordinates (D1). */
export const KIT_PLAN = "kit.plan";
/** The lead's follow-up child (`herdr start --followup`): value `1`. It never settles, and `wait --all` leaves it out. */
export const KIT_FOLLOWUP = "kit.followup";
export const KIT_INDEPENDENT = "kit.independent";
export const KIT_STARTED_BY = "kit.started-by";
export const KIT_LABELS = {
  lead: KIT_LEAD,
  repo: KIT_REPO,
  task: KIT_TASK,
  plan: KIT_PLAN,
  followup: KIT_FOLLOWUP,
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

export const CLAUDE_CODE_APP = "claude-code";

export const HERDR_SPACE = "herdr.space";
export const HERDR_TAB = "herdr.tab";
export function newHerdrSpace(): { space: string; tab: string } {
  return {
    space: `sp${crypto.randomUUID().replaceAll("-", "")}`,
    tab: `tb${crypto.randomUUID().replaceAll("-", "")}`,
  };
}
