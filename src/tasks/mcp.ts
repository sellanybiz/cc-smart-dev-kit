import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { VERSION } from "../build-info";
import { PLUGIN } from "../build-info/names";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";
import { createTaskOps, type TaskOpsOptions } from "./ops";
import { READ_ONLY_OPERATIONS, type TaskOperation, taskSchemas } from "./schemas";
import { TASK_TOOL } from "./words";

export const TASK_SERVER_INSTRUCTIONS = `These tools are your session's task list. Work tasks stay on this machine.
A step owed before or after a deploy to prod or staging is a deploy task (kind prod or staging): its file travels with your branch, so commit it. Before any deploy, production or database work, list them (${TASK_TOOL.list} with scope project); close each with evidence (/${PLUGIN}:tasks).
The phase task's description is the builder's brief. Read it with task_get; save the report with task_note, starting Report:.
The main session saves Ruling: notes and sets agent, branch, worktree and base on the phase.
After compaction, task_list scope plan and git log are the truth.
Finish or drop every blocking task before marking its parent done.
Three layers: plan › phase › task. A non-blocking task holds nothing; a task blocked by an open task waits for it.
A plan holds at most plans.maxPhases phases, and a phase starts only once it holds tasks. Lay phases in any of your plans, up front; run one plan at a time: starting work in a plan puts it in flight, and a start in another plan is refused until the first is finished or parked (park = its plan task to pending, once its phases stop; resume = start a phase again). A later ask waits as a task under its plan (parent = the plan's #n). A task made with no plan and no parent is loose: a small fix needs no plan, and it never joins or starts one.
A step of a phase closes done with evidence, or dropped with a note that gives the reason.
Save notes as you go with ${TASK_TOOL.note}.`;
const descriptions: Record<TaskOperation, string> = {
  take: "Take a plan or task into the calling session. Live claims need force; a refusal changes nothing.",
  create:
    "Create a work task (kind work, the default), or a deploy task for prod or staging (deploy and type required; pair true with staging also creates its prod twin): a file to commit with this branch. Create the plan's phases here (phase): at most plans.maxPhases per plan, each holding its tasks. A plan without parent creates the plan itself; to add a task to a plan, give its phase as parent, or the plan as parent to make it wait there for a phase. A task with neither plan nor parent is loose, whatever plans are open. Phases may be laid in any of your plans; one plan is in flight at a time.",
  update: `Update a task: its status, type, parent or blockers; status open reopens a closed deploy task. Starting work claims it for this Claude process and puts its plan in flight; a phase starts only with tasks, and not while another plan of yours is in flight. Setting an in-flight plan's task to pending parks it, refused while its phases run. A task waiting under a plan moves under a phase of that plan with parent. Close a step with ${TASK_TOOL.done}.`,
  done: 'Finish or drop a task. Its open blocking tasks must be finished or dropped first. A step of a phase, and every deploy task, finishes with evidence or drops with a note; only the person drops a blocking deploy task. The answer lists your own work this close freed ("now ready"): start it, phases together.',
  note: "Save a note on a task as work proceeds.",
  list: "List the caller's tasks as a tree, or list the plan or project (scope project also lists the open deploy tasks).",
  get: "Read a task, its notes and its history: each change with its time, the values before and after, and the session that made it. Use offset to read the next part; history true also prints every earlier description.",
  search: "Search work tasks and deploy tasks.",
  delete: "Delete a mistaken task with no notes or tasks, or an untracked deploy task file.",
};

export function createTaskServer(options: TaskOpsOptions = {}) {
  // The server never drops a blocking deploy task: that is the person's, in their own terminal.
  const ops = createTaskOps({ ...options, refuseBlockingDrop: true });
  const server = new McpServer(
    { name: TASKS_SERVER_NAME, version: VERSION },
    { instructions: TASK_SERVER_INSTRUCTIONS },
  );
  // One tool per operation the schemas define: `TASK_TOOL[operation]` fails the type check when
  // an operation has no tool name.
  for (const operation of Object.keys(taskSchemas) as TaskOperation[]) {
    server.registerTool(
      TASK_TOOL[operation],
      {
        description: descriptions[operation],
        inputSchema: taskSchemas[operation],
        annotations: {
          readOnlyHint: READ_ONLY_OPERATIONS.has(operation),
          destructiveHint: operation === "delete",
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        const answer = ops.call(operation, input);
        return {
          content: [{ type: "text" as const, text: answer.ok ? answer.text : answer.why }],
          ...(answer.ok ? {} : { isError: true }),
        };
      },
    );
  }
  server.server.onclose = () => ops.close();
  return {
    server,
    close: async () => {
      await server.close();
      ops.close();
    },
  };
}
export async function runTaskMcp(): Promise<void> {
  const { server } = createTaskServer();
  await server.connect(new StdioServerTransport());
}
