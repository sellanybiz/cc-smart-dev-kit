import type { LimitRecord } from "./limit-state";
import { claudeFamily } from "./targets";

/** Records a successful messages answer ends: shared windows need proof of room. */
export function recordsEndedBy(
  answerModel: string,
  headers: Headers,
  limits: Readonly<Record<string, LimitRecord>>,
): string[] {
  const hasRoom = (window: "5h" | "7d"): boolean => {
    const value = headers.get(`anthropic-ratelimit-unified-${window}-utilization`);
    if (value === null || value.trim() === "") return false;
    const utilization = Number(value);
    return Number.isFinite(utilization) && utilization >= 0 && utilization < 1;
  };
  return Object.entries(limits)
    .filter(([model, record]) => {
      if (model === answerModel || record.claim === null) return true;
      switch (record.claim) {
        case "five_hour":
          return hasRoom("5h");
        case "seven_day":
          return hasRoom("7d");
        case "seven_day_opus":
          return claudeFamily(answerModel) === "opus";
        case "seven_day_sonnet":
          return claudeFamily(answerModel) === "sonnet";
        default:
          return false;
      }
    })
    .map(([model]) => model);
}
