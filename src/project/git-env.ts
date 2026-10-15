/**
 * Git variables that would point git at another repo than the folder it runs in.
 * A git hook sets some of them, so we drop them: git always works on the folder named.
 */
const REPO_SELECTING_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
];

/** `base` without the variables that point git at another repo, and without unset ones. */
export function gitEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !REPO_SELECTING_GIT_VARS.includes(key)) env[key] = value;
  }
  return env;
}
