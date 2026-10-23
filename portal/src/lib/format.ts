/**
 * How the portal writes numbers, times and names. One home: every page formats through here.
 */

/**
 * The kit's command name. The same value as `COMMAND` in `src/build-info/names.ts`; the portal
 * is its own package and cannot import the kit's build macro, so the served facts will carry it
 * once B6b serves them.
 */
export const KIT_NAME = "cc-smart-dev-kit";

const SLOT_PREFIX = `${KIT_NAME}-`;

/** `cc-smart-dev-kit-scout` → `scout`: a slot as a person types it. */
export function slotName(key: string): string {
  return key.startsWith(SLOT_PREFIX) ? key.slice(SLOT_PREFIX.length) : key;
}

/** `omniroute:glm-5.3` → `glm-5.3`; a Claude target stays as it is. */
export function targetModel(target: string): string {
  const colon = target.indexOf(":");
  return colon === -1 ? target : target.slice(colon + 1);
}

/** The backend part of a target, or `Claude login` for a `claude-…` model. */
export function targetBackend(target: string): string {
  const colon = target.indexOf(":");
  return colon === -1 ? "Claude login" : target.slice(0, colon);
}

const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function count(value: number): string {
  return integer.format(value);
}

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** `1234567` → `1.2M`: a token count. */
export function compact(value: number): string {
  return compactNumber.format(value);
}

/** An estimated cost in US dollars: four decimals below a cent, two above. */
export function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function percent(share: number): string {
  return `${integer.format(share * 100)} %`;
}

/** `850` → `850 ms`, `12400` → `12.4 s`, `194000` → `3 min 14 s`, `943000` → `16 min`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${integer.format(ms)} ms`;
  if (ms < 60_000) return `${oneDecimal.format(ms / 1000)} s`;
  const minutes = Math.floor(ms / 60_000);
  // From ten minutes up, the seconds are noise: the minute is enough.
  if (minutes >= 10 && minutes < 60) return `${Math.round(ms / 60_000)} min`;
  if (minutes < 60) {
    const seconds = Math.round((ms % 60_000) / 1000);
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A duration in one unit, for a chart's axis: `40 s`, `2 min`, `3 h`. */
export function shortDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${oneDecimal.format(ms / 3_600_000)} h`;
}

/** Seconds as a duration. */
export function seconds(value: number): string {
  return duration(value * 1000);
}

/** A clock time, `13:52`. */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** A clock time with seconds, `13:52:07`. */
export function clockSeconds(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** `3 min ago`, `2 h ago`, `4 days ago`: how long ago, in words. */
export function ago(at: number | string, now: number = Date.now()): string {
  const ms = now - (typeof at === "string" ? Date.parse(at) : at);
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 45_000) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** `in 52 min`: how long until, in words. */
export function until(at: number | string, now: number = Date.now()): string {
  const ms = (typeof at === "string" ? Date.parse(at) : at) - now;
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= 0) return "now";
  return `in ${duration(Math.round(ms / 1000) * 1000)}`;
}

/** `128` → `128 MB`, `1536` → `1.5 GB`. */
export function megabytes(mb: number): string {
  return mb < 1024 ? `${integer.format(mb)} MB` : `${oneDecimal.format(mb / 1024)} GB`;
}
