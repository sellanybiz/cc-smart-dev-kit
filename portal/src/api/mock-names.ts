/**
 * The names the mock data shows, in the real shapes (`./types.ts`): the tag and the plan of the
 * placeholder repository, and the crew name built from them (D58: a crew session is
 * `C <tag> <plan> <phase> <slug>`, `crewName` in `src/crew/names.ts`; before 1.1.2 it was
 * `C <tag> <phase> <slug>`).
 *
 * **One home**, so a record, the events it wrote and the pages that list it never show two
 * different names for one crew session.
 */

/** The tag of the placeholder repository (the main checkout's folder name). */
export const MOCK_TAG = "my-app";

/** The plan of its lead: the word its name and every crew session's name carries. */
export const MOCK_PLAN = "release-1.1.0";

/** A crew session's name, `C <tag> <plan> <phase> <slug>`. */
export function mockCrewName(phase: string, slug: string): string {
  return `C ${MOCK_TAG} ${MOCK_PLAN} ${phase} ${slug}`;
}
