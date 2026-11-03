import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { VERSION } from "../build-info";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";
import { createTaskOps, type TaskOpsOptions } from "./ops";
import { type TaskOperation, taskSchemas } from "./schemas";
import { TASK_TOOL } from "./words";

export const TASK_SERVER_INSTRUCTIONS = `These tools are your session's task list. Work tasks stay on this machine.
An obligation for production, the database, a teammate or later is a project task: commit its file with your branch.
A crew session's work goes under its phase task. Finish or drop every blocking subtask before marking its parent done.
Three layers: phase › task › subtask. A non-blocking task holds nothing; a task blocked by an open task waits for it.
Save notes as you go with ${TASK_TOOL.note}.`;
const descriptions: Record<TaskOperation, string> = {
  create:
    "Create a work task, or a project task file to commit with this branch. A lead also lays out its plan's phases here (phase).",
  update:
    "Update a task: its status, type, parent or blockers. Starting work claims it for this Claude process.",
  done: "Finish or drop a task. Its open blocking subtasks must be finished or dropped first.",
  note: "Save a note on a task as work proceeds.",
  list: "List the caller's tasks as a tree, or list the plan or project.",
  get: "Read a task, its notes and its history: each change with its time, the values before and after, and the session that made it. Use offset to read the next part; history true also prints every earlier description.",
  search: "Search work and project tasks.",
  delete: "Delete a mistaken task with no notes or subtasks, or an untracked project task file.",
};
const READ_ONLY: ReadonlySet<TaskOperation> = new Set(["list", "get", "search"]);

export function createTaskServer(options: TaskOpsOptions = {}) {
  const ops = createTaskOps(options);
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
          readOnlyHint: READ_ONLY.has(operation),
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
