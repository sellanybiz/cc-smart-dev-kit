/** The slop record: what a closed plan adds, what an audit takes away, and when one is due. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { repoKey } from "./reviews";
import {
  areasOf,
  readSlop,
  recordAudit,
  recordSlop,
  SLOP_PLANS_KEPT,
  type SlopRecord,
  slopFile,
  slopStatus,
  slopStatusLines,
} from "./slop";

const AT = Date.parse("2026-11-01T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** The record file of one repository in a fresh state folder. */
function freshFile(): string {
  return slopFile(tempDir("state"), "/home/user/app");
}

function closed(plan: string, bypassed = 0, drifted = 0, areas: string[] = []) {
  return { plan, bypassed, drifted, areas };
}

describe("slopFile and areasOf", () => {
  test("the file is the repository's own, under the state folder", () => {
    expect(slopFile("/state", "/home/user/app")).toBe(
      `/state/slop/${repoKey("/home/user/app")}.json`,
    );
  });

  test("an area is a path cut to its first two segments, each once, sorted", () => {
    expect(
      areasOf([
        "src/workflow/claims.ts",
        "src/workflow/slop.ts",
        "plugin/skills/",
        "README.md",
        "docs/design/workflow.md",
        "src/cli/",
      ]),
    ).toEqual(["README.md", "docs/design", "plugin/skills", "src/cli", "src/workflow"]);
  });

  test("no path, no area", () => {
    expect(areasOf([])).toEqual([]);
  });
});

describe("record", () => {
  test("a closed plan is written, mode 0600, and read back", async () => {
    const file = freshFile();
    const record = await recordSlop(file, closed("alpha", 1, 2, ["src/cli"]), AT);
    expect(record).toEqual({
      auditedAt: null,
      plans: [
        {
          plan: "alpha",
          at: "2026-11-01T10:00:00.000Z",
          bypassed: 1,
          drifted: 2,
          areas: ["src/cli"],
        },
      ],
    });
    expect(readSlop(file)).toEqual(record);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("no file is an empty record", () => {
    expect(readSlop(freshFile())).toEqual({ auditedAt: null, plans: [] });
  });

  test("a second record of the same plan replaces the first", async () => {
    const file = freshFile();
    await recordSlop(file, closed("alpha", 3, 0), AT);
    await recordSlop(file, closed("beta"), AT + DAY);
    const record = await recordSlop(file, closed("alpha", 0, 1), AT + 2 * DAY);
    expect(record.plans.map((one) => [one.plan, one.bypassed, one.drifted, one.at])).toEqual([
      ["beta", 0, 0, "2026-11-02T10:00:00.000Z"],
      ["alpha", 0, 1, "2026-11-03T10:00:00.000Z"],
    ]);
  });

  test("only the newest plans stay", async () => {
    const file = freshFile();
    for (let index = 0; index <= SLOP_PLANS_KEPT; index += 1) {
      await recordSlop(file, closed(`plan-${index}`), AT + index * 1000);
    }
    const { plans } = readSlop(file);
    expect(plans).toHaveLength(SLOP_PLANS_KEPT);
    expect(plans[0]?.plan).toBe("plan-1");
    expect(plans.at(-1)?.plan).toBe(`plan-${SLOP_PLANS_KEPT}`);
  });

  test("a write waits for the record's own lock and keeps what the holder wrote", async () => {
    const file = freshFile();
    mkdirSync(dirname(file), { recursive: true });
    let pending: Promise<SlopRecord> | null = null;
    await withLock(dirname(file), async () => {
      pending = recordSlop(file, closed("beta"), AT + DAY);
      writeFileSync(
        file,
        JSON.stringify({
          auditedAt: null,
          plans: [
            { plan: "alpha", at: "2026-11-01T10:00:00.000Z", bypassed: 0, drifted: 0, areas: [] },
          ],
        }),
      );
      await Bun.sleep(150);
      expect(readSlop(file).plans.map((one) => one.plan)).toEqual(["alpha"]);
    });
    await pending;
    expect(readSlop(file).plans.map((one) => one.plan)).toEqual(["alpha", "beta"]);
  });

  test("a file that is not a slop record is refused with its fix, and left alone", async () => {
    const file = freshFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect(() => readSlop(file)).toThrow(`${file} is not a slop record`);
    await expect(recordSlop(file, closed("alpha"), AT)).rejects.toThrow(
      "Delete it to start the count again.",
    );
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  test("a record with a negative count is refused", () => {
    const file = freshFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        auditedAt: null,
        plans: [{ plan: "a", at: "x", bypassed: -1, drifted: 0, areas: [] }],
      }),
    );
    expect(() => readSlop(file)).toThrow("is not a slop record");
  });
});

describe("status: when an audit is due", () => {
  const plan = (name: string, bypassed = 0, drifted = 0, at = "2026-11-01T10:00:00.000Z") => ({
    plan: name,
    at,
    bypassed,
    drifted,
    areas: ["src/cli"],
  });

  test("a new record is not due", () => {
    expect(slopStatus({ auditedAt: null, plans: [] }, 5)).toEqual({
      since: null,
      plans: [],
      bypassed: 0,
      drifted: 0,
      areas: [],
      due: false,
      why: null,
    });
  });

  test("four clean plans of five are not due; the fifth makes it due, by count", () => {
    const four = ["a", "b", "c", "d"].map((name) => plan(name));
    expect(slopStatus({ auditedAt: null, plans: four }, 5).due).toBe(false);
    const status = slopStatus({ auditedAt: null, plans: [...four, plan("e")] }, 5);
    expect(status.due).toBe(true);
    expect(status.why).toBe("5 plans closed since the last audit (every 5)");
  });

  test("the plan just recorded left a bypassed home or a drifted copy: due at once, by finding", () => {
    const status = slopStatus(
      {
        auditedAt: "2026-10-01T00:00:00.000Z",
        plans: [plan("a"), plan("b", 1, 2, "2026-11-02T10:00:00.000Z")],
      },
      5,
    );
    expect(status).toMatchObject({
      since: "2026-10-01T00:00:00.000Z",
      bypassed: 1,
      drifted: 2,
      areas: ["src/cli"],
      due: true,
      why: "plan b left 1 bypassed home and 2 drifted copies",
    });
  });

  test("a finding in an older plan does not make a later clean one due", () => {
    const status = slopStatus(
      { auditedAt: null, plans: [plan("a", 2, 0), plan("b", 0, 0, "2026-11-02T10:00:00.000Z")] },
      5,
    );
    expect(status).toMatchObject({ due: false, why: null, bypassed: 2 });
  });

  test("both reasons are named", () => {
    const plans = ["a", "b", "c"].map((name) => plan(name));
    plans.push(plan("d", 0, 1, "2026-11-05T10:00:00.000Z"));
    expect(slopStatus({ auditedAt: null, plans }, 4).why).toBe(
      "4 plans closed since the last audit (every 4); plan d left 0 bypassed homes and 1 drifted copy",
    );
  });

  test("everyPlans 0 turns the count off, and a finding still makes an audit due", () => {
    const clean = ["a", "b", "c", "d", "e", "f"].map((name) => plan(name));
    expect(slopStatus({ auditedAt: null, plans: clean }, 0).due).toBe(false);
    const found = [...clean, plan("g", 1, 0, "2026-11-09T10:00:00.000Z")];
    expect(slopStatus({ auditedAt: null, plans: found }, 0).due).toBe(true);
  });

  test("the lines say due or not, the last audit, the totals, the plans and the areas", () => {
    const record: SlopRecord = {
      auditedAt: "2026-10-01T00:00:00.000Z",
      plans: [plan("a", 1, 0)],
    };
    expect(slopStatusLines(slopStatus(record, 5), 5)).toEqual([
      "Slop audit: due — plan a left 1 bypassed home and 0 drifted copies",
      "Last audit: 2026-10-01T00:00:00.000Z",
      "Since then: 1 bypassed, 0 drifted",
      "Plans: a (1 bypassed, 0 drifted)",
      "Areas: src/cli",
    ]);
    expect(slopStatusLines(slopStatus({ auditedAt: null, plans: [] }, 0), 0)).toEqual([
      "Slop audit: not due (0 plans since the last audit; cadence off)",
      "Last audit: never",
      "Since then: 0 bypassed, 0 drifted",
    ]);
  });
});

describe("audited", () => {
  async function filled(): Promise<string> {
    const file = freshFile();
    await recordSlop(file, closed("alpha", 1, 0, ["src/cli", "src/workflow"]), AT);
    await recordSlop(file, closed("beta", 0, 1, ["src/workflow"]), AT + DAY);
    await recordSlop(file, closed("gamma", 0, 0, []), AT + 2 * DAY);
    return file;
  }

  test("with no area, every plan is audited and the count starts again", async () => {
    const file = await filled();
    expect(await recordAudit(file, [], AT + 3 * DAY)).toEqual({
      auditedAt: "2026-11-04T10:00:00.000Z",
      plans: [],
    });
    expect(slopStatus(readSlop(file), 5).due).toBe(false);
  });

  test("named areas: a plan with every area audited leaves, one with areas left keeps them", async () => {
    const file = await filled();
    const record = await recordAudit(file, ["src/workflow"], AT + 3 * DAY);
    expect(record.auditedAt).toBe("2026-11-04T10:00:00.000Z");
    expect(record.plans.map((one) => [one.plan, one.areas])).toEqual([
      ["alpha", ["src/cli"]],
      ["gamma", []],
    ]);
  });

  test("an area nothing recorded changes no plan", async () => {
    const file = await filled();
    const record = await recordAudit(file, ["docs/design"], AT + 3 * DAY);
    expect(record.plans.map((one) => one.plan)).toEqual(["alpha", "beta", "gamma"]);
  });
});
