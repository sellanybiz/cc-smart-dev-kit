import { expect, test } from "bun:test";
import { COMMAND, PLUGIN } from "../build-info/names";
import { renderManagedMarkdown, renderWithoutBlock } from "../setup/managed-markdown";
import { deployBlockBody } from "./deploy-block";

test("the block names both gate commands, the deploy branch, the closes and the tasks skill", () => {
  const body = deployBlockBody();
  expect(body).toContain(`\`${COMMAND} task release <env> --before\``);
  expect(body).toContain(`\`${COMMAND} task release <env> --after\``);
  expect(body).toContain("git switch --no-track -c deploy/<env>-<date> origin/<base>");
  expect(body).toContain(
    "git worktree add --no-track -b deploy/<env>-<date> <folder> origin/<base>",
  );
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
