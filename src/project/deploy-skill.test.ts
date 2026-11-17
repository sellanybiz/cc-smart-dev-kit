/** The deploy-skill block: find, plan, write, and the stale check. Every file is in a temp folder. */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BLOCK_BEGIN, BLOCK_END } from "../setup/managed-markdown";
import { tempDir } from "../testing/temp";
import { deployBlockBody, deploySkillStarter } from "./deploy-block";
import {
  applyDeploySkill,
  findDeploySkills,
  planDeploySkill,
  planNewDeploySkill,
  skillsFolderLink,
  staleBlocks,
} from "./deploy-skill";

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
      const old = `${BLOCK_BEGIN}\n## Deploy tasks\nold text\n${BLOCK_END}`;
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

describe("mixed line endings are never rewritten", () => {
  for (const [label, original] of [
    ["ends with CRLF", "# Deploy\r\n\r\nRun it.\nthen ship\r\n"],
    ["ends with LF", "# Deploy\r\nRun it.\nthen ship\n"],
  ] as const) {
    test(`${label}: insert, update, then remove leave every other byte as it was`, () => {
      const { root, stateDir } = world();
      const file = skill(root, "deploy", original);
      const add = planDeploySkill(root, file, "write");
      expect(add.action).toBe("add");
      expect(add.text.startsWith(original)).toBe(true);
      applyDeploySkill(root, add, { stateDir });
      expect(readFileSync(file, "utf8")).toBe(add.text);
      // The same file again is no change at all.
      expect(planDeploySkill(root, file, "write").action).toBe("none");
      const remove = planDeploySkill(root, file, "remove");
      expect(remove.action).toBe("remove");
      applyDeploySkill(root, remove, { stateDir });
      expect(readFileSync(file, "utf8")).toBe(original);
    });
  }

  test("an old block in a mixed file is replaced and its surroundings stay byte for byte", () => {
    const { root, stateDir } = world();
    const around = ["a\r\n\r\n", "\nb\r\nc\n"];
    const file = skill(
      root,
      "deploy",
      `${around[0]}${BLOCK_BEGIN}\n## Deploy tasks\nold\n${BLOCK_END}${around[1]}`,
    );
    applyDeploySkill(root, planDeploySkill(root, file, "write"), { stateDir });
    expect(readFileSync(file, "utf8")).toBe(`${around[0]}${BLOCK}${around[1]}`);
  });
});

describe("only the deploy block counts", () => {
  const FENCED = `# Kit blocks\n\nA managed section looks like this:\n\n\`\`\`md\n${BLOCK_BEGIN}\n${BODY}\n${BLOCK_END}\n\`\`\`\n`;
  const OTHER = `# Other\n\n${BLOCK_BEGIN}\nSome other kit section.\n${BLOCK_END}\n`;

  test("a skill that shows the markers in a code fence, or holds another block, is no holder", () => {
    const { root } = world();
    skill(root, "kit-docs", FENCED);
    skill(root, "other", OTHER);
    skill(root, "tilde", `~~~\n${BLOCK}\n~~~\n`);
    expect(findDeploySkills(root)).toEqual({ holders: [], named: [] });
    expect(staleBlocks(root)).toEqual([]);
  });

  test("an indented example of the block (four spaces, or in a list) is no holder", () => {
    const { root, stateDir } = world();
    const indented = `# Docs\n\n    ${BLOCK_BEGIN}\n    ${BODY.split("\n")[0]}\n    ${BLOCK_END}\n`;
    const listed = `- Example:\n  ${BLOCK_BEGIN}\n  ${BODY.split("\n")[0]}\n  ${BLOCK_END}\n`;
    skill(root, "indented-docs", indented);
    skill(root, "listed-docs", listed);
    expect(findDeploySkills(root)).toEqual({ holders: [], named: [] });
    // Named deploy, the example is still not rewritten.
    const named = skill(root, "deploy", indented);
    const plan = planDeploySkill(root, named, "write");
    expect(plan.action).toBe("refused");
    expect(applyDeploySkill(root, plan, { stateDir })).toBeNull();
    expect(readFileSync(named, "utf8")).toBe(indented);
  });

  test("a real block after a fenced example is still found", () => {
    const { root } = world();
    // The fence holds markers, so the file is a holder whose plan refuses (by hand), never a rewrite.
    const file = skill(root, "kit-docs", `${FENCED}\n${BLOCK}\n`);
    expect(findDeploySkills(root).holders).toEqual([file]);
    expect(planDeploySkill(root, file, "write").action).toBe("refused");
  });

  test("a deploy-named skill with fenced markers or another block is refused, not rewritten", () => {
    const { root, stateDir } = world();
    const fenced = skill(root, "deploy-docs", FENCED);
    const other = skill(root, "deploy-other", OTHER);
    for (const [file, text, why] of [
      [fenced, FENCED, "shows the cc-smart-dev-kit markers inside a code block"],
      [other, OTHER, "has a cc-smart-dev-kit block that is not the deploy block"],
    ] as const) {
      for (const mode of ["write", "remove"] as const) {
        const plan = planDeploySkill(root, file, mode);
        expect(plan.action).toBe("refused");
        expect(plan.problem).toContain(why);
        expect(applyDeploySkill(root, plan, { stateDir })).toBeNull();
      }
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });
});

describe("refusals", () => {
  test("a symlinked folder that points outside the checkout is found and refused, naming the link", () => {
    const { root, stateDir } = world();
    const outside = tempDir("deploy-skill-outside");
    writeFileSync(join(outside, "SKILL.md"), AROUND_BEFORE);
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    const link = join(root, ".claude", "skills", "deploy");
    symlinkSync(outside, link);
    const found = findDeploySkills(root);
    expect(found.named).toEqual([join(link, "SKILL.md")]);
    const plan = planDeploySkill(root, found.named[0] ?? "", "write");
    expect(plan.action).toBe("refused");
    expect(plan.problem).toBe(
      `.claude/skills/deploy/SKILL.md is outside this checkout (a link to ${join(realpathSync(outside), "SKILL.md")}): not changed`,
    );
    expect(applyDeploySkill(root, plan, { stateDir })).toBeNull();
    expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe(AROUND_BEFORE);
  });

  test("a skills folder that is a link out of the checkout is named, and not searched", () => {
    const { root } = world();
    expect(skillsFolderLink(root)).toBeNull();
    const outside = tempDir("deploy-skill-outside");
    mkdirSync(join(outside, "deploy"), { recursive: true });
    writeFileSync(join(outside, "deploy", "SKILL.md"), AROUND_BEFORE);
    mkdirSync(join(root, ".claude"), { recursive: true });
    symlinkSync(outside, join(root, ".claude", "skills"));
    expect(skillsFolderLink(root)).toBe(
      ".claude/skills is a link outside this checkout: not searched",
    );
    expect(findDeploySkills(root)).toEqual({ holders: [], named: [] });
  });

  test("a skills folder inside the checkout, even through a link, is searched as usual", () => {
    const { root } = world();
    mkdirSync(join(root, "shared", "deploy"), { recursive: true });
    writeFileSync(join(root, "shared", "deploy", "SKILL.md"), AROUND_BEFORE);
    mkdirSync(join(root, ".claude"), { recursive: true });
    symlinkSync(join(root, "shared"), join(root, ".claude", "skills"));
    expect(skillsFolderLink(root)).toBeNull();
    expect(findDeploySkills(root).named).toHaveLength(1);
  });

  test("a plain path that leaves the checkout says so without naming a link", () => {
    const { root } = world();
    const plan = planDeploySkill(root, join(root, "..", "elsewhere.md"), "write");
    expect(plan.problem).toBe("../elsewhere.md is outside this checkout: not changed");
  });

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
    const old = skill(root, "ship-deploy", `${BLOCK_BEGIN}\n## Deploy tasks\nold\n${BLOCK_END}\n`);
    const broken = skill(
      root,
      "ops/deploy",
      `${BLOCK_BEGIN}\n## Deploy tasks\nhalf\n${BLOCK_BEGIN}\n`,
    );
    skill(root, "deploy-none", "no block here");
    const stale = staleBlocks(root);
    expect(stale.map((one) => one.file).sort()).toEqual([old, broken].sort());
    expect(stale.find((one) => one.file === old)?.why).toBe("the block's text is out of date");
    expect(stale.find((one) => one.file === old)?.fix).toBe("init");
    expect(stale.find((one) => one.file === broken)?.why).toContain("broken");
    expect(stale.find((one) => one.file === broken)?.fix).toBe("by-hand");
  });

  test("a holder outside the checkout is by hand: init refuses to write it", () => {
    const { root } = world();
    const outside = tempDir("deploy-skill-outside");
    writeFileSync(join(outside, "SKILL.md"), `x\n${BLOCK}\n`);
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    symlinkSync(outside, join(root, ".claude", "skills", "deploy"));
    const [only] = staleBlocks(root);
    expect(only?.fix).toBe("by-hand");
    expect(only?.why).toContain("outside this checkout");
  });
});

describe("a new deploy skill (planNewDeploySkill)", () => {
  const NEW = ".claude/skills/deploy/SKILL.md";

  test("plans the starter as a new file: every line a + line, nothing read, nothing written", () => {
    const { root } = world();
    const result = planNewDeploySkill(root);
    if (!("plan" in result)) throw new Error(`expected a plan, got: ${result.note}`);
    const plan = result.plan;
    expect(plan.action).toBe("create");
    expect(plan.shown).toBe(NEW);
    expect(plan.file).toBe(join(root, NEW));
    expect(plan.changed).toBe(true);
    expect(plan.problem).toBeNull();
    expect(plan.before).toBe("");
    expect(plan.text).toBe(deploySkillStarter());
    expect(plan.diff[0]).toBe("+ ---");
    expect(plan.diff).toContain("+ name: deploy");
    expect(plan.diff).toContain("+ ## This project's deploy steps");
    expect(plan.diff).toContain("+ ## Deploy tasks");
    // Every non-blank line of the file, in order.
    expect(plan.diff).toEqual(
      deploySkillStarter()
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => `+ ${line}`),
    );
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  test("the write creates the folders and the file (mode 0644), with no backup", () => {
    const { root, stateDir } = world();
    const result = planNewDeploySkill(root);
    if (!("plan" in result)) throw new Error("expected a plan");
    const write = applyDeploySkill(root, result.plan, { stateDir });
    expect(write).toEqual({ file: join(root, NEW), created: true, backup: null });
    expect(readFileSync(join(root, NEW), "utf8")).toBe(deploySkillStarter());
    if (process.platform !== "win32") {
      expect(statSync(join(root, NEW)).mode & 0o777).toBe(0o644);
    }
    expect(existsSync(join(stateDir, "backups"))).toBe(false);
    expect(readdirSync(join(root, ".claude", "skills", "deploy"))).toEqual(["SKILL.md"]);
  });

  test("a dry run writes nothing", () => {
    const { root, stateDir } = world();
    const result = planNewDeploySkill(root);
    if (!("plan" in result)) throw new Error("expected a plan");
    expect(applyDeploySkill(root, result.plan, { stateDir, dryRun: true })).toEqual({
      file: join(root, NEW),
      created: true,
      backup: null,
    });
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  test("doctor sees the new file as a current block, and taking the block out keeps the rest", () => {
    const { root, stateDir } = world();
    const result = planNewDeploySkill(root);
    if (!("plan" in result)) throw new Error("expected a plan");
    applyDeploySkill(root, result.plan, { stateDir });
    expect(findDeploySkills(root).holders).toEqual([join(root, NEW)]);
    expect(staleBlocks(root)).toEqual([]);
    expect(planDeploySkill(root, join(root, NEW), "write").changed).toBe(false);
    const removed = planDeploySkill(root, join(root, NEW), "remove");
    expect(removed.action).toBe("remove");
    expect(removed.text).not.toContain(BLOCK_BEGIN);
    expect(removed.text).toContain("## This project's deploy steps");
  });

  test("a path that is already there is never overwritten: a note, no plan", () => {
    const { root, stateDir } = world();
    const file = skill(root, "deploy", "# my own deploy\n");
    expect(planNewDeploySkill(root)).toEqual({
      note: `${NEW} already exists: not overwritten; --deploy-skill <path> names the deploy skill`,
    });
    expect(readFileSync(file, "utf8")).toBe("# my own deploy\n");
    // A plan made while the path was free is stopped by the write itself, the file untouched.
    const fresh = world();
    const planned = planNewDeploySkill(fresh.root);
    if (!("plan" in planned)) throw new Error("expected a plan");
    mkdirSync(join(fresh.root, ".claude", "skills", "deploy"), { recursive: true });
    writeFileSync(join(fresh.root, NEW), "someone else's\n");
    expect(() => applyDeploySkill(fresh.root, planned.plan, { stateDir })).toThrow(
      `${NEW} already exists: nothing was written to it`,
    );
    expect(readFileSync(join(fresh.root, NEW), "utf8")).toBe("someone else's\n");
  });

  test("a dangling link at the path counts as there", () => {
    const { root } = world();
    mkdirSync(join(root, ".claude", "skills", "deploy"), { recursive: true });
    symlinkSync(join(root, "nowhere.md"), join(root, NEW));
    expect(planNewDeploySkill(root)).toEqual({
      note: `${NEW} already exists: not overwritten; --deploy-skill <path> names the deploy skill`,
    });
  });

  test("a skills folder linked from outside the checkout is not written to", () => {
    const { root } = world();
    const outside = tempDir("deploy-skill-outside");
    mkdirSync(join(root, ".claude"), { recursive: true });
    symlinkSync(outside, join(root, ".claude", "skills"));
    expect(planNewDeploySkill(root)).toEqual({
      note: ".claude/skills is a link outside this checkout: not searched",
    });
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a deploy folder linked from outside the checkout is not written to", () => {
    const { root } = world();
    const outside = tempDir("deploy-skill-outside");
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    symlinkSync(outside, join(root, ".claude", "skills", "deploy"));
    const result = planNewDeploySkill(root);
    expect("note" in result && result.note).toContain("outside this checkout");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a /deploy command would be shadowed by the skill: a note, no plan", () => {
    const { root } = world();
    for (const path of ["deploy.md", "ops/Deploy-prod.md"]) {
      const file = join(root, ".claude", "commands", path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "run the deploy\n");
      expect(planNewDeploySkill(root)).toEqual({
        note: `.claude/commands/${path} already answers /deploy: no skill created; --deploy-skill <path> names a skill to add the section to`,
      });
      rmSync(file);
    }
  });

  test("a command that is not a deploy leaves the plan alone", () => {
    const { root } = world();
    mkdirSync(join(root, ".claude", "commands"), { recursive: true });
    writeFileSync(join(root, ".claude", "commands", "review.md"), "review\n");
    writeFileSync(join(root, ".claude", "commands", "deploy-notes.txt"), "not a command\n");
    const result = planNewDeploySkill(root);
    expect("plan" in result && result.notes).toEqual([]);
  });

  test("a skill that says release or ship may hold the steps: the plan stands, with a note naming it", () => {
    const { root } = world();
    skill(root, "release-train", "x");
    skill(root, "publish", "x", "ship-it");
    skill(root, "review", "x", "review");
    const result = planNewDeploySkill(root);
    if (!("plan" in result)) throw new Error("expected a plan");
    expect(result.plan.action).toBe("create");
    expect(result.notes).toEqual([
      ".claude/skills/publish/SKILL.md may already hold this project's deploy steps; --deploy-skill .claude/skills/publish/SKILL.md adds the section there instead",
      ".claude/skills/release-train/SKILL.md may already hold this project's deploy steps; --deploy-skill .claude/skills/release-train/SKILL.md adds the section there instead",
    ]);
  });

  test("a file where the folder should be gives a note, not a crash", () => {
    const { root } = world();
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "deploy"), "a file");
    const result = planNewDeploySkill(root);
    expect("note" in result && result.note).toContain(`${NEW} cannot be created`);
  });
});
