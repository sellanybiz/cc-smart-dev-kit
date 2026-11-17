/** The deploy-skill block: find, plan, write, and the stale check. Every file is in a temp folder. */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BLOCK_BEGIN, BLOCK_END } from "../setup/managed-markdown";
import { tempDir } from "../testing/temp";
import { deployBlockBody } from "./deploy-block";
import { applyDeploySkill, findDeploySkills, planDeploySkill, staleBlocks } from "./deploy-skill";

const BODY = deployBlockBody();
const BLOCK = `${BLOCK_BEGIN}\n${BODY}\n${BLOCK_END}`;

function skill(root: string, folder: string, text: string, name?: string): string {
  const dir = join(root, ".claude", "skills", folder);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  const header = name === undefined ? "" : `---\nname: ${name}\ndescription: x\n---\n`;
  writeFileSync(file, `${header}${text}`);
  return file;
}

function world(): { root: string; stateDir: string } {
  return { root: tempDir("deploy-skill"), stateDir: tempDir("deploy-skill-state") };
}

const AROUND_BEFORE = "# Deploy\n\nRun the build.\n";
const AROUND_AFTER = "\n## Rollback\n\nRevert the merge.\n";

describe("find", () => {
  test("a folder named deploy, a front matter name with deploy, and a marker holder", () => {
    const { root } = world();
    const byFolder = skill(root, "deploy-prod", "x");
    const byName = skill(root, "ship", "x", "release-deploy");
    skill(root, "review", "x", "review");
    const holder = skill(root, "ops/other", `x\n${BLOCK}\n`);
    const found = findDeploySkills(root);
    expect(found.named.sort()).toEqual([byFolder, byName].sort());
    expect(found.holders).toEqual([holder]);
  });

  test("no skills folder: nothing found", () => {
    expect(findDeploySkills(tempDir("deploy-skill"))).toEqual({ holders: [], named: [] });
  });
});

describe("plan and write: the text around the block stays byte for byte", () => {
  for (const [label, eol] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const) {
    const around = (text: string) => text.replace(/\n/g, eol);
    const block = BLOCK.replace(/\n/g, eol);

    test(`${label}: insert at the end, update in place, remove again`, () => {
      const { root, stateDir } = world();
      const original = around(`${AROUND_BEFORE}`);
      const file = skill(root, "deploy", original);

      const add = planDeploySkill(root, file, "write");
      expect(add.action).toBe("add");
      expect(add.text.startsWith(original)).toBe(true);
      expect(add.diff[0]).toBe("+ ## Deploy tasks");
      expect(applyDeploySkill(root, add, { stateDir })?.backup).not.toBeNull();
      expect(readFileSync(file, "utf8")).toBe(`${original}${eol}${block}${eol}`);

      // The block in the middle of the person's own text, with an old wording.
      const old = `${BLOCK_BEGIN}\nold text\n${BLOCK_END}`;
      const middle = around(`${AROUND_BEFORE}\n${old}\n${AROUND_AFTER}`);
      writeFileSync(file, middle);
      const update = planDeploySkill(root, file, "write");
      expect(update.action).toBe("update");
      expect(update.diff).toContain("- old text");
      applyDeploySkill(root, update, { stateDir });
      expect(readFileSync(file, "utf8")).toBe(
        around(`${AROUND_BEFORE}\n`) + block + around(`\n${AROUND_AFTER}`),
      );

      const remove = planDeploySkill(root, file, "remove");
      expect(remove.action).toBe("remove");
      applyDeploySkill(root, remove, { stateDir });
      expect(readFileSync(file, "utf8")).toBe(around(`${AROUND_BEFORE}${AROUND_AFTER}`));
    });

    test(`${label}: an appended block is removed with nothing left behind`, () => {
      const { root, stateDir } = world();
      const original = around(AROUND_BEFORE);
      const file = skill(root, "deploy", original);
      applyDeploySkill(root, planDeploySkill(root, file, "write"), { stateDir });
      applyDeploySkill(root, planDeploySkill(root, file, "remove"), { stateDir });
      expect(readFileSync(file, "utf8")).toBe(original);
    });
  }

  test("a file that is already current: no change, no write, no backup", () => {
    const { root, stateDir } = world();
    const file = skill(root, "deploy", `${AROUND_BEFORE}\n${BLOCK}\n`);
    const plan = planDeploySkill(root, file, "write");
    expect(plan.action).toBe("none");
    expect(plan.changed).toBe(false);
    expect(applyDeploySkill(root, plan, { stateDir })).toBeNull();
    expect(existsSync(join(stateDir, "backups"))).toBe(false);
  });

  test("removing from a file with no block changes nothing", () => {
    const { root } = world();
    const file = skill(root, "deploy", AROUND_BEFORE);
    expect(planDeploySkill(root, file, "remove").action).toBe("none");
  });

  test("a dry run writes nothing and makes no backup", () => {
    const { root, stateDir } = world();
    const file = skill(root, "deploy", AROUND_BEFORE);
    const write = applyDeploySkill(root, planDeploySkill(root, file, "write"), {
      stateDir,
      dryRun: true,
    });
    expect(write).toEqual({ file, created: false, backup: null });
    expect(readFileSync(file, "utf8")).toBe(AROUND_BEFORE);
    expect(existsSync(join(stateDir, "backups"))).toBe(false);
  });

  test("a write keeps the file's mode and leaves no changed.json entry", () => {
    const { root, stateDir } = world();
    const file = skill(root, "deploy", AROUND_BEFORE);
    applyDeploySkill(root, planDeploySkill(root, file, "write"), { stateDir });
    expect(existsSync(join(stateDir, "changed.json"))).toBe(false);
    expect(readdirSync(join(root, ".claude", "skills", "deploy"))).toEqual(["SKILL.md"]);
  });
});

describe("refusals", () => {
  test("a symlink that points outside the checkout is refused, in the plan and in the write", () => {
    const { root, stateDir } = world();
    const outside = tempDir("deploy-skill-outside");
    const target = join(outside, "SKILL.md");
    writeFileSync(target, AROUND_BEFORE);
    mkdirSync(join(root, ".claude", "skills", "deploy"), { recursive: true });
    const link = join(root, ".claude", "skills", "deploy", "SKILL.md");
    symlinkSync(target, link);
    const plan = planDeploySkill(root, link, "write");
    expect(plan.action).toBe("refused");
    expect(plan.problem).toContain("outside this checkout");
    expect(plan.changed).toBe(false);
    expect(readFileSync(target, "utf8")).toBe(AROUND_BEFORE);
    // A plan made before the link was swapped in is stopped by the write itself.
    const swapped = { ...plan, changed: true, text: "x" };
    expect(() => applyDeploySkill(root, swapped, { stateDir })).toThrow("outside this checkout");
    expect(readFileSync(target, "utf8")).toBe(AROUND_BEFORE);
  });

  test("a symlink to a file inside the checkout is followed and the target changes", () => {
    const { root, stateDir } = world();
    mkdirSync(join(root, "docs"), { recursive: true });
    const target = join(root, "docs", "deploy.md");
    writeFileSync(target, AROUND_BEFORE);
    mkdirSync(join(root, ".claude", "skills", "deploy"), { recursive: true });
    const link = join(root, ".claude", "skills", "deploy", "SKILL.md");
    symlinkSync(target, link);
    applyDeploySkill(root, planDeploySkill(root, link, "write"), { stateDir });
    expect(readFileSync(target, "utf8")).toContain(BLOCK_BEGIN);
  });

  test("a broken marker pair is named and nothing is written", () => {
    const { root, stateDir } = world();
    const text = `${AROUND_BEFORE}${BLOCK_BEGIN}\nhalf\n`;
    const file = skill(root, "deploy", text);
    for (const mode of ["write", "remove"] as const) {
      const plan = planDeploySkill(root, file, mode);
      expect(plan.action).toBe("refused");
      expect(plan.problem).toContain(".claude/skills/deploy/SKILL.md");
      expect(plan.problem).toContain("broken cc-smart-dev-kit block");
      expect(applyDeploySkill(root, plan, { stateDir })).toBeNull();
    }
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  test("a file changed after the plan is not overwritten", () => {
    const { root, stateDir } = world();
    const file = skill(root, "deploy", AROUND_BEFORE);
    const plan = planDeploySkill(root, file, "write");
    writeFileSync(file, `${AROUND_BEFORE}someone else's line\n`);
    expect(() => applyDeploySkill(root, plan, { stateDir })).toThrow(
      "changed while project init ran: nothing was written to it",
    );
    expect(readFileSync(file, "utf8")).toBe(`${AROUND_BEFORE}someone else's line\n`);
    expect(readdirSync(join(root, ".claude", "skills", "deploy"))).toEqual(["SKILL.md"]);
  });

  test("a path that is not a file is refused", () => {
    const { root } = world();
    const plan = planDeploySkill(
      root,
      join(root, ".claude", "skills", "nope", "SKILL.md"),
      "write",
    );
    expect(plan.action).toBe("refused");
    expect(plan.problem).toBe(".claude/skills/nope/SKILL.md is not a file");
  });
});

describe("staleBlocks", () => {
  test("lists a block whose text is old or whose markers are broken, not a current one or none", () => {
    const { root } = world();
    skill(root, "deploy", `x\n${BLOCK}\n`);
    const old = skill(root, "ship-deploy", `${BLOCK_BEGIN}\nold\n${BLOCK_END}\n`);
    const broken = skill(root, "ops/deploy", `${BLOCK_BEGIN}\nhalf\n${BLOCK_BEGIN}\n`);
    skill(root, "deploy-none", "no block here");
    const stale = staleBlocks(root);
    expect(stale.map((one) => one.file).sort()).toEqual([old, broken].sort());
    expect(stale.find((one) => one.file === old)?.why).toBe("the block's text is out of date");
    expect(stale.find((one) => one.file === broken)?.why).toContain("broken");
  });
});
