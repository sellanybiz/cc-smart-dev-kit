/**
 * One line for a failed zod parse, the way the kit's own files report one: each issue as
 * `<field>: <message>` (`(top level)` for the whole value) and an unknown key as
 * `<key>: unknown field`, joined by `; `. The caller puts `Invalid <file>: ` in front.
 */
import type { z } from "zod";

export function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
      return issue.code === "unrecognized_keys"
        ? `${issue.keys.join(", ")}: unknown field`
        : `${field}: ${issue.message}`;
    })
    .join("; ");
}
