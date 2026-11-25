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
      areasOf(
        [
          "src/workflow/claims.ts",
          "src/workflow/slop.ts",
          "plugin/skills/",
          "./src/cli/",
          "Makefile",
        ],
        [],
      ),
    ).toEqual(["Makefile", "plugin/skills", "src/cli", "src/workflow"]);
  });

  test("a prose file and the kit's plan and research folders are no area", () => {
    expect(
      areasOf(
        [
          "README.md",
          "docs/design/workflow.md",
          "docs/notes.TXT",
          ".claude/plans/2026-11-25-slop.md",
          ".claude/plans/",
          ".claude/research/data/run.json",
          ".claude/rules/testing.md",
          ".claude/settings.json",
          "src/a.ts",
        ],
        [],
      ),
    ).toEqual([".claude/settings.json", "src/a.ts"]);
  });

  test("a checkout that ignores case skips the plan folder named in another case", () => {
    expect(areasOf([".Claude/Plans/x.json"], [], true)).toEqual([]);
    expect(areasOf([".Claude/Plans/x.json"], [])).toEqual([".Claude/Plans"]);
  });

  test("the merge files and build output are no area", () => {
    expect(
      areasOf(
        [
          "CHANGELOG.md",
          "plugin/dist/cli.js",
          "plugin/dist/",
          "plugin/.claude-plugin/plugin.json",
          "app/dist/",
          "packages/web/dist/index.js",
          "node_modules/zod/index.js",
          "src/dist.ts",
        ],
        ["CHANGELOG.md", "plugin/dist/", "plugin/.claude-plugin/plugin.json"],
      ),
    ).toEqual(["src/dist.ts"]);
  });

  test("a checkout that ignores case settles a merge file named in another case, as the overlap check does", () => {
    const paths = ["Package.json", "Docs/notes.ts"];
    expect(areasOf(paths, ["package.json", "docs/"], true)).toEqual([]);
    expect(areasOf(paths, ["package.json", "docs/"])).toEqual(["Docs/notes.ts", "Package.json"]);
  });

  test("no path, no area", () => {
    expect(areasOf([], [])).toEqual([]);
  });
});

describe("record", () => {
  test("a closed plan is written, mode 0600, and read back", async () => {
    const file = freshFile();
    const record = await recordSlop(file, closed("alpha", 1, 2, ["src/cli"]), AT);
    expect(record).toEqual({
      auditedAt: null,
      unaudited: 1,
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
    expect(readSlop(freshFile())).toEqual({ auditedAt: null, unaudited: 0, plans: [] });
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
    expect(record.unaudited).toBe(2);
  });

  test("only the newest plans stay, and the count still holds every one", async () => {
    const file = freshFile();
    for (let index = 0; index <= SLOP_PLANS_KEPT; index += 1) {
      await recordSlop(file, closed(`plan-${index}`), AT + index * 1000);
    }
    const { plans, unaudited } = readSlop(file);
    expect(plans).toHaveLength(SLOP_PLANS_KEPT);
    expect(plans[0]?.plan).toBe("plan-1");
    expect(plans.at(-1)?.plan).toBe(`plan-${SLOP_PLANS_KEPT}`);
    expect(unaudited).toBe(SLOP_PLANS_KEPT + 1);
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
          unaudited: 1,
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
        unaudited: 1,
        plans: [{ plan: "a", at: "x", bypassed: -1, drifted: 0, areas: [] }],
      }),
    );
    expect(() => readSlop(file)).toThrow("is not a slop record");
  });

  test("a field a newer version added is read past, and the count is kept", () => {
    const file = freshFile();
    mkdirSync(dirname(file), { recursive: true });
    const plan = { plan: "a", at: "x", bypassed: 1, drifted: 0, areas: [] };
    writeFileSync(
      file,
      JSON.stringify({ auditedAt: null, unaudited: 1, later: true, plans: [{ ...plan, more: 1 }] }),
    );
    expect(readSlop(file)).toEqual({ auditedAt: null, unaudited: 1, plans: [plan] });
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
  /** A record of these plans, none of them cleared by an audit. */
  const record = (plans: SlopRecord["plans"], auditedAt: string | null = null): SlopRecord => ({
    auditedAt,
    unaudited: plans.length,
    plans,
  });

  test("a new record is not due", () => {
    expect(slopStatus(record([]), 5)).toEqual({
      since: null,
      unaudited: 0,
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
    expect(slopStatus(record(four), 5).due).toBe(false);
    const status = slopStatus(record([...four, plan("e")]), 5);
    expect(status.due).toBe(true);
    expect(status.why).toBe("5 plans closed and not audited yet (every 5)");
  });

  test("by count it is due at each multiple only: a declined offer comes back five plans later", () => {
    const at = (unaudited: number) =>
      slopStatus({ auditedAt: null, unaudited, plans: [plan("a")] }, 5).due;
    expect([5, 6, 9, 10, 11, 15].map(at)).toEqual([true, false, false, true, false, true]);
  });

  test("a cadence above the plans kept still comes due: the count is not the list", () => {
    const status = slopStatus({ auditedAt: null, unaudited: 60, plans: [plan("a")] }, 60);
    expect(status).toMatchObject({
      due: true,
      why: "60 plans closed and not audited yet (every 60)",
    });
  });

  test("the plan just recorded left a bypassed home or a drifted copy: due at once, by finding", () => {
    const status = slopStatus(
      record([plan("a"), plan("b", 1, 2, "2026-11-02T10:00:00.000Z")], "2026-10-01T00:00:00.000Z"),
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
      record([plan("a", 2, 0), plan("b", 0, 0, "2026-11-02T10:00:00.000Z")]),
      5,
    );
    expect(status).toMatchObject({ due: false, why: null, bypassed: 2 });
  });

  test("both reasons are named", () => {
    const plans = ["a", "b", "c"].map((name) => plan(name));
    plans.push(plan("d", 0, 1, "2026-11-05T10:00:00.000Z"));
    expect(slopStatus(record(plans), 4).why).toBe(
      "4 plans closed and not audited yet (every 4); plan d left 0 bypassed homes and 1 drifted copy",
    );
  });

  test("everyPlans 0 turns the count off, and a finding still makes an audit due", () => {
    const clean = ["a", "b", "c", "d", "e", "f"].map((name) => plan(name));
    expect(slopStatus(record(clean), 0).due).toBe(false);
    const found = [...clean, plan("g", 1, 0, "2026-11-09T10:00:00.000Z")];
    expect(slopStatus(record(found), 0).due).toBe(true);
  });

  test("the lines say due or not, the last audit, what is not audited yet, the plans and the areas", () => {
    expect(
      slopStatusLines(slopStatus(record([plan("a", 1, 0)], "2026-10-01T00:00:00.000Z"), 5), 5),
    ).toEqual([
      "Slop audit: due — plan a left 1 bypassed home and 0 drifted copies",
      "Last audit: 2026-10-01T00:00:00.000Z",
      "Not audited yet: 1 bypassed, 0 drifted",
      "Plans: a (1 bypassed, 0 drifted)",
      "Areas: src/cli",
    ]);
    expect(slopStatusLines(slopStatus(record([]), 0), 0)).toEqual([
      "Slop audit: not due (0 plans not audited yet; cadence off)",
      "Last audit: never",
      "Not audited yet: 0 bypassed, 0 drifted",
    ]);
    const six = { auditedAt: null, unaudited: 6, plans: [plan("a")] };
    expect(slopStatusLines(slopStatus(six, 5), 5)[0]).toBe(
      "Slop audit: not due (6 plans not audited yet; cadence every 5 plans, next at 10)",
    );
  });

  test("an audit after the newest plan makes nothing due, by count or by finding", () => {
    const audited = "2026-11-03T00:00:00.000Z";
    const found = slopStatus(record([plan("a", 1, 0)], audited), 5);
    expect(found).toMatchObject({ due: false, why: null, bypassed: 1 });
    const five = ["a", "b", "c", "d", "e"].map((name) => plan(name));
    expect(slopStatus(record(five, audited), 5)).toMatchObject({ due: false, why: null });
  });

  test("plans past the ones kept are counted, and a line says only an audit of everything clears them", () => {
    const lines = slopStatusLines(
      slopStatus({ auditedAt: null, unaudited: 53, plans: [plan("a")] }, 5),
      5,
    );
    expect(lines.slice(3)).toEqual([
      "Plans: a (0 bypassed, 0 drifted)",
      "Areas: src/cli",
      `Not listed: 52 plans past the ${SLOP_PLANS_KEPT} kept. Only cc-smart-dev-kit workflow slop audited with no --area clears them.`,
    ]);
  });

  test("a plan that named no area is listed with the one audit that clears it", () => {
    const lines = slopStatusLines(slopStatus(record([{ ...plan("a"), areas: [] }]), 5), 5);
    expect(lines.slice(3)).toEqual([
      "Plans: a (0 bypassed, 0 drifted)",
      "No area: a. Only an audit with no --area clears a plan that named no area.",
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
      record: { auditedAt: "2026-11-04T10:00:00.000Z", unaudited: 0, plans: [] },
      cleared: 3,
    });
    expect(slopStatus(readSlop(file), 5).due).toBe(false);
  });

  test("named areas: a plan with every area audited leaves, one with areas left keeps them", async () => {
    const file = await filled();
    const { record, cleared } = await recordAudit(file, ["src/workflow"], AT + 3 * DAY);
    expect(cleared).toBe(1);
    expect(record.auditedAt).toBe("2026-11-04T10:00:00.000Z");
    expect(record.unaudited).toBe(2);
    expect(record.plans.map((one) => [one.plan, one.areas])).toEqual([
      ["alpha", ["src/cli"]],
      ["gamma", []],
    ]);
  });

  test("a parent folder clears every area under it; a plan that named no area stays", async () => {
    const file = await filled();
    const { record, cleared } = await recordAudit(file, ["src"], AT + 3 * DAY);
    expect(cleared).toBe(2);
    expect(record.unaudited).toBe(1);
    expect(record.plans.map((one) => one.plan)).toEqual(["gamma"]);
  });

  test("an audit of some areas makes nothing due until the next plan closes", async () => {
    const file = freshFile();
    await recordSlop(file, closed("a", 1, 0, ["src/a", "src/b"]), AT);
    await recordSlop(file, closed("b", 0, 0, ["src/c"]), AT + DAY);
    expect(slopStatus(readSlop(file), 5).due).toBe(false);
    await recordAudit(file, ["src/c"], AT + 2 * DAY);
    expect(slopStatus(readSlop(file), 5)).toMatchObject({ unaudited: 1, due: false, why: null });
    await recordSlop(file, closed("c", 0, 2, ["src/d"]), AT + 3 * DAY);
    expect(slopStatus(readSlop(file), 5)).toMatchObject({
      due: true,
      why: "plan c left 0 bypassed homes and 2 drifted copies",
    });
  });

  test("an audit that leaves the count on a multiple does not make it due", async () => {
    const file = freshFile();
    for (let index = 0; index < 7; index += 1) {
      await recordSlop(
        file,
        closed(`p${index}`, 0, 0, [index < 2 ? "src/x" : "src/y"]),
        AT + index * 1000,
      );
    }
    const { cleared } = await recordAudit(file, ["src/x"], AT + DAY);
    expect(cleared).toBe(2);
    expect(slopStatus(readSlop(file), 5)).toMatchObject({ unaudited: 5, due: false });
  });

  test("a checkout that ignores case clears an area named in another case", async () => {
    const file = freshFile();
    await recordSlop(file, closed("alpha", 0, 0, ["Src/CLI"]), AT);
    expect((await recordAudit(file, ["src"], AT + DAY)).cleared).toBe(0);
    expect((await recordAudit(file, ["src"], AT + DAY, true)).cleared).toBe(1);
  });

  test("a path deeper than an area, or one that only starts like it, clears nothing", async () => {
    const file = await filled();
    for (const path of ["src/workflow/claims.ts", "src/work", "docs/design"]) {
      const { record, cleared } = await recordAudit(file, [path], AT + 3 * DAY);
      expect(cleared).toBe(0);
      expect(record.plans.map((one) => one.plan)).toEqual(["alpha", "beta", "gamma"]);
    }
  });
});
