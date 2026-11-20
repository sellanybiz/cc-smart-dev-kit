import { expect, test } from "bun:test";
import { COMMAND, PLUGIN } from "../build-info/names";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  renderManagedMarkdown,
  renderWithoutBlock,
} from "../setup/managed-markdown";
import { deployBlockBody, deploySkillStarter } from "./deploy-block";

test("the block names both gate commands, the deploy branch, the closes and the tasks skill", () => {
  const body = deployBlockBody();
  expect(body).toContain(`\`${COMMAND} task release <env> --before\``);
  expect(body).toContain(`\`${COMMAND} task release <env> --after\``);
  expect(body).toContain("git switch --no-track -c deploy/<env>-<date> origin/<base>");
  expect(body).not.toContain("worktree add");
  expect(body).toContain("each one belongs to prod or staging");
  expect(body).toContain("commit the closes on the deploy branch");
  expect(body).toContain("pull request");
  expect(body).toContain(`\`/${PLUGIN}:tasks\``);
  // Short: it sits inside a project's own skill.
  expect(body.split("\n").length).toBeLessThanOrEqual(15);
});

test("the first line is exactly `## Deploy tasks`: it identifies the block across kit versions", () => {
  // Written by hand: a change here is a break with every skill an older kit wrote (deploy-block.ts).
  expect(deployBlockBody().split("\n")[0]).toBe("## Deploy tasks");
});

test("the block goes in and out of a skill file and leaves the text around it as it was", () => {
  const skill = "---\nname: deploy\n---\n# Deploy\n\nRun the script.\n";
  const withBlock = renderManagedMarkdown(skill, deployBlockBody());
  expect(withBlock).toContain(deployBlockBody());
  expect(withBlock.startsWith(skill)).toBe(true);
  expect(renderWithoutBlock(withBlock)).toBe(skill);
});

test("the starter skill: front matter, the steps section that says none are written, then the block", () => {
  const starter = deploySkillStarter();
  expect(starter.startsWith("---\nname: deploy\ndescription: ")).toBe(true);
  const header = starter.split("\n---\n")[0]?.replace(/^---\n/, "") ?? "";
  const parsed = Bun.YAML.parse(header) as { name: string; description: string };
  expect(parsed.name).toBe("deploy");
  expect(parsed.description).toContain("deploying this project");
  expect(parsed.description).toContain("staging");
  expect(parsed.description).toContain("prod");
  expect(starter).toContain("\n# Deploy\n");
  expect(starter).toContain("\n## This project's deploy steps\n");
  expect(starter).toContain("never invent a deploy command");
  // The paragraph removes itself once the steps are in, and an empty skill never deploys.
  expect(starter).toContain(
    "Replace this paragraph with them. Until then, do not run a deploy: ask the person.",
  );
  // The block is the managed one: the same markers and body every other writer uses.
  expect(starter.endsWith(`${BLOCK_BEGIN}\n${deployBlockBody()}\n${BLOCK_END}\n`)).toBe(true);
  expect(starter.indexOf("## This project's deploy steps")).toBeLessThan(
    starter.indexOf(BLOCK_BEGIN),
  );
  // Neutral: no package manager or project command in the text that is not the block.
  expect(starter.split(BLOCK_BEGIN)[0]).not.toMatch(/\b(bun|npm|pnpm|yarn)\b/);
});

test("the line after the heading says what holds a deploy, with or without the field", () => {
  // Written by hand: the plan's wording, and the heading stays the first line.
  expect(deployBlockBody().split("\n").slice(0, 4)).toEqual([
    "## Deploy tasks",
    "",
    "Do not run a deploy while that environment has work that holds a deploy (a blocking before-deploy task, a broken task file; `task release <env> --check` shows it).",
    "",
  ]);
});
