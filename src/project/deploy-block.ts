/**
 * The text of the section `project init` keeps in a project's deploy skill (D8). One home: the
 * writer (`deploy-skill.ts`) and `doctor`'s stale-block check both read `deployBlockBody()`, so
 * a change to the wording reaches every project the next time `project init` runs.
 *
 * It is short on purpose. The full teaching is the `tasks` skill; this block only puts the two
 * gate commands and the order of a deploy run where the person's own deploy steps are.
 */
import { COMMAND, PLUGIN } from "../build-info/names";

/** The text between the managed markers. `<env>`, `<date>` and `<base>` are for the reader to fill in. */
export function deployBlockBody(): string {
  const release = `${COMMAND} task release`;
  return [
    "## Deploy tasks",
    "",
    "Steps owed around a deploy are deploy tasks, one for each of prod and staging. Run these steps in the checkout you work in:",
    "",
    "1. Cut a deploy branch from the commit that ships: `git fetch origin`, then `git switch -c deploy/<env>-<date> origin/<base>`.",
    `2. Run \`${release} <env> --before\`. It lists what must be done first and exits 1 while a blocking task is open.`,
    "3. Do each task. Close it with evidence (what you ran or checked, and its result), and commit the closes on the deploy branch.",
    "4. Deploy, with the steps of this skill.",
    `5. Run \`${release} <env> --after\`. It exits 1 while any task of that environment is open, a close is uncommitted, or the branch is not pushed.`,
    "6. Open the deploy branch's pull request (the task files only) and merge it as the workflow says.",
    "",
    `The rules for every kind of task: \`/${PLUGIN}:tasks\`.`,
  ].join("\n");
}
