import { withLock } from "../setup/lock";
import { type RestoreResult, restore } from "../setup/restore";
import { type CliPaths, tildify } from "./paths";

function describe(result: RestoreResult, short: (path: string) => string): string {
  const file = short(result.file);
  switch (result.action) {
    case "restored":
      return `~ ${file}: back as it was before cc-agentic`;
    case "removed":
      return `- ${file}: removed (cc-agentic had created it)`;
    case "cleaned":
      return `~ ${file}: removed ${result.details.join(", ")}; everything else kept`;
    case "unchanged":
      return `  ${file}: nothing of cc-agentic left in it`;
    case "no-backup":
      return `! ${file}: the backup from before cc-agentic is missing; left alone`;
  }
}

export async function runRestore(paths: CliPaths): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  return withLock(
    paths.stateDir,
    () => {
      const results = restore(paths.stateDir);
      if (results.length === 0) {
        console.log("Nothing to restore: cc-agentic has nothing in any file.");
        return 0;
      }
      for (const result of results) {
        console.log(describe(result, short));
        if (result.savedAs) {
          console.log(`  (its state before this restore: ${short(result.savedAs)})`);
        }
      }
      return results.some((result) => result.action === "no-backup") ? 1 : 0;
    },
    { waitMs: 10_000 },
  );
}
