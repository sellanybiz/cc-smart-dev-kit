/**
 * Does a person see this session's messages? Claude Code sets `CLAUDE_CODE_SESSION_ATTENDED=0`
 * for its hooks in `claude -p` (and `1` in an interactive session; seen on 2.1.300). The
 * hook's input does not say which (the same fields in both). Without the variable (another
 * Claude Code version), the session counts as attended.
 *
 * Its home is here, not in `src/update/`, so a hook that only needs this answer does not pull
 * the self-update's code into its bundle. The self-update (`src/update/background.ts`) and
 * the worktree hooks (`src/worktrees/auto-start.ts`) both ask it.
 */
export function isAttended(env: Record<string, string | undefined>): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
}
