import { expect, test } from "bun:test";
import { emptyConfig } from "../gateway/config";
import { type RouterFacts, slotRows } from "./facts";

const ROUTER: RouterFacts = {
  breakers: {},
  cooling: [],
  fallbacks: 0,
  port: 21111,
  recent: [],
  requests: 0,
  up: true,
  uptimeSec: 0,
  why: "",
};

test("D64: Slots targets show active and saved pins, never a Claude target's", () => {
  const config = {
    ...emptyConfig(),
    slots: { "cc-smart-dev-kit-scout": ["backend:model", "claude-haiku-5-5"] },
    effort: { "cc-smart-dev-kit-scout": { "backend:model": "xhigh" as const } },
    kept: {
      "cc-smart-dev-kit-worker": {
        targets: ["backend:other"],
        effort: { "backend:other": "none" as const },
      },
    },
  };
  const rows = slotRows(config, ROUTER);
  expect(rows.find((row) => row.name === "scout")?.targets).toMatchObject([
    { target: "backend:model", effort: "xhigh" },
    { target: "claude-haiku-5-5" },
  ]);
  expect(rows.find((row) => row.name === "worker")?.kept?.targets[0]).toMatchObject({
    effort: "none",
  });
  expect(rows.find((row) => row.name === "scout")?.targets[1]).not.toHaveProperty("effort");
});

test("the judge's saved chain shows the judge's own switch: on by default, off when the person said so (2026-10-27)", () => {
  const kept = { "cc-smart-dev-kit-judge": { targets: ["backend:judge"] } };
  const keptFallback = (config: ReturnType<typeof emptyConfig>) =>
    slotRows(config, ROUTER).find((row) => row.name === "judge")?.kept?.fallback;
  const noteOf = (config: ReturnType<typeof emptyConfig>) =>
    slotRows(config, ROUTER).find((row) => row.name === "judge")?.note;
  const byDefault = { ...emptyConfig(), kept };
  expect(keptFallback(byDefault)).toBe(true);
  expect(noteOf(byDefault)).toContain("saved, not in use: backend:judge (fallback on)");
  const off = { ...emptyConfig(), fallback: { "cc-smart-dev-kit-judge": false }, kept };
  expect(keptFallback(off)).toBe(false);
  expect(noteOf(off)).toContain("saved, not in use: backend:judge (fallback off)");
  // Another slot's saved chain keeps the switch saved with it, else that slot's default (off).
  const worker = {
    ...emptyConfig(),
    kept: { "cc-smart-dev-kit-worker": { targets: ["backend:w"] } },
  };
  expect(slotRows(worker, ROUTER).find((row) => row.name === "worker")?.kept?.fallback).toBe(false);
});
