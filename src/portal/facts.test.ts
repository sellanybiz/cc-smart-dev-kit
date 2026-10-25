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
