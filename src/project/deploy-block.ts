/**
 * The text of the section `project init` keeps in a project's deploy skill (D8). One home: the
 * writer (`deploy-skill.ts`) and `doctor`'s stale-block check both read `deployBlockBody()`, so
 * a change to the wording reaches every project the next time `project init` runs.
 *
 * It is short on purpose. The full teaching is the `tasks` skill; this block only puts the two
 * gate commands and the order of a deploy run where the person's own deploy steps are.
 */
import { COMMAND, PLUGIN } from "../build-info/names";
import { renderManagedMarkdown } from "../setup/managed-markdown";

/**
 * The text between the managed markers. `<env>`, `<date>` and `<base>` are for the reader to fill in.
 *
 * **The first line, `## Deploy tasks`, must not change.** It is how `deploy-skill.ts` tells this
 * block from any other cc-smart-dev-kit block, in a skill written by an older kit version too:
 * a block that starts with another line is no longer found, so it is never updated and `doctor`
 * never warns about it. The rest of the text may change freely.
 */
export function deployBlockBody(): string {
  const release = `${COMMAND} task release`;
  return [
    "## Deploy tasks",
    "",
    "When `tasks.deployCommands` lists this project's deploy commands, the deploy guard asks before one runs while a blocking task is open.",
    "",
    "Steps owed around a deploy are deploy tasks; each one belongs to prod or staging. Run these steps in the checkout you work in:",
    "",
    "1. Cut a deploy branch from the commit that ships: `git fetch origin`, then `git switch --no-track -c deploy/<env>-<date> origin/<base>` (--no-track keeps `git push` from targeting `<base>`).",
    `2. Run \`${release} <env> --before\`. It lists what must be done first and exits 1 while a blocking task is open.`,
    "3. Do each task. Close it with evidence (what you ran or checked, and its result), and commit the closes on the deploy branch.",
    "4. Deploy, with the steps of this skill.",
    `5. Run \`${release} <env> --after\`. It exits 1 while any task of that environment is open, a close is uncommitted, or the branch is not pushed (\`git push -u origin <branch>\`).`,
    "6. Open the deploy branch's pull request (the task files only) and merge it as the workflow says.",
    "",
    `The rules for every kind of task: \`/${PLUGIN}:tasks\`.`,
  ].join("\n");
}

/**
 * The starter text of a deploy skill `project init` creates when a project has none: front
 * matter that lets Claude pick the skill for a deploy, a section that says the project's own
 * steps are not written yet (Claude asks the person for them and never makes up a command), and
 * then the managed block, put in by `renderManagedMarkdown` so its markers are the ones every
 * other writer and `doctor` read. It names no project and no tool: the steps are the person's.
 */
export function deploySkillStarter(): string {
  const own = [
    "---",
    "name: deploy",
    "description: Use when deploying this project to staging or prod, or when asked to release, ship or roll back a deploy.",
    "---",
    "",
    "# Deploy",
    "",
    "## This project's deploy steps",
    "",
    "The deploy steps of this project are not written yet. Ask the person how this project deploys: the commands, their order, the checks to run and how to roll back. Write the steps in this section, and never invent a deploy command. Replace this paragraph with them. Until then, do not run a deploy: ask the person.",
    "",
  ].join("\n");
  return renderManagedMarkdown(own, deployBlockBody());
}
