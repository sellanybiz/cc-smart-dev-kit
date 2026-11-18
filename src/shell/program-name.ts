/**
 * The name of the program a shell word runs. A leaf: it imports nothing, so the shell reader
 * (`command.ts`) and the kit's own recogniser (`kit-invocation.ts`) can both use it without
 * importing each other.
 */

/** `git.exe` → `git`, `C:\Program Files\Git\cmd\git` → `git`. */
export function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
}
