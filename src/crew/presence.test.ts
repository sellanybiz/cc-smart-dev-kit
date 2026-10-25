import { expect, test } from "bun:test";
import { boardWorld } from "../testing/board-world";
import { sessionUnknown } from "./end";

test.each(["[null]", '[{"state":"done"}]'])(
  "partial agent view %s does not prove a crew session unknown",
  async (json) => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    expect(sessionUnknown(world.ctx({}, { FAKE_AGENTS_JSON: json }), record)).toBe(false);
  },
);
