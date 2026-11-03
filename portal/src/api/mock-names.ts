/** Placeholder project and session names shared by the mock answers. */
export const MOCK_TAG = "my-app";
export const MOCK_PLAN = "release-1.1.0";
export function mockSessionName(phase: string, slug: string): string {
  return `${MOCK_TAG}: ${phase} ${slug}`;
}
