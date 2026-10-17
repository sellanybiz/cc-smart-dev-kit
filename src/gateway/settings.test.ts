/**
 * The address of a backend as output may show it, or a page may link to it: never a credential.
 */
import { describe, expect, test } from "bun:test";
import { backendAddress, shownBackendUrl } from "./settings";

describe("a backend's address, shown", () => {
  test("PB-7: no user name, no password, no key in the query, no fragment", () => {
    const url =
      "http://someone:PLANTED_PASS@127.0.0.1:20128/api?key=PLANTED_QUERY&x=1#PLANTED_HASH";
    expect(backendAddress(url)).toBe("http://127.0.0.1:20128/api");
    expect(shownBackendUrl(url, "omni_PLANTED_SECRET_a1b2")).toBe(
      "http://127.0.0.1:20128/api (key ••••a1b2)",
    );
  });

  test("a plain address stays as it is, without its last slash", () => {
    expect(backendAddress("http://127.0.0.1:20128/")).toBe("http://127.0.0.1:20128");
    expect(shownBackendUrl("http://127.0.0.1:20128", "short")).toBe(
      "http://127.0.0.1:20128 (key ••••)",
    );
  });

  test("text that is not a URL is never shown at all", () => {
    expect(backendAddress("not a url PLANTED")).toBeNull();
    expect(shownBackendUrl("not a url PLANTED", "omni_PLANTED_SECRET_a1b2")).toBe("(key ••••a1b2)");
  });
});
