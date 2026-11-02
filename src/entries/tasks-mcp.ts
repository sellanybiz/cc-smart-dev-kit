import { runTaskMcp } from "../tasks/mcp";

try {
  await runTaskMcp();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
