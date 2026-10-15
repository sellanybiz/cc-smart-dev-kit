/**
 * The search client: the request it sends, the answer it reads, and every way a request
 * can fail. Each test starts a fake OmniRoute on a free port of its own (never 20100,
 * where a real router may run); the expected values are written by hand.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { fakeProxy, withProxyEnv } from "../testing/proxy-env";
import {
  fetchPage,
  parseFetchedPage,
  parseSearchAnswer,
  type SearchAnswer,
  searchWeb,
} from "./client";

/** A made-up backend key. 28 characters, so no generic masking rule catches it by luck:
 * the tests prove the code masks the key it was given, not that a key looks like one. */
const KEY = "omni_live_SENTINEL_0123456789";

interface Call {
  body: string;
  method: string;
  path: string;
  authorization: null | string;
  contentType: null | string;
}

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A fake OmniRoute on a free port: it records each request and answers what `handler` says. */
function fakeOmniRoute(handler: (body: string, call: number) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      const body = await req.text();
      calls.push({
        authorization: req.headers.get("authorization"),
        body,
        contentType: req.headers.get("content-type"),
        method: req.method,
        path: new URL(req.url).pathname,
      });
      return handler(body, calls.length);
    },
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, calls };
}

/** A port where nothing listens: a server that was started, took a free port, and stopped. */
function closedPort(): number {
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(""),
  });
  const port = server.port as number;
  server.stop(true);
  return port;
}

/** OmniRoute's answer to `POST /v1/search`, as it answered on 2026-10-15. */
const ANSWER = {
  cached: false,
  errors: [],
  id: "search-2c4884bc-fb03-4132-84e9-2c6c71868a73",
  metrics: { response_time_ms: 847, total_results_available: 5, upstream_latency_ms: 847 },
  provider: "ollama-search",
  query: "bun runtime",
  results: [
    {
      citation: { provider: "ollama-search", rank: 1, retrieved_at: "2026-10-15T17:38:43.000Z" },
      display_url: "bun.com/",
      position: 1,
      snippet: "Bun is a fast JavaScript runtime & toolkit.",
      title: "Bun — A fast all-in-one JavaScript runtime",
      url: "https://bun.com/",
    },
    {
      position: 2,
      snippet: "Bun v1.4.3 is out.",
      title: "Releases · oven-sh/bun",
      url: "https://github.com/oven-sh/bun/releases",
    },
  ],
  usage: { queries_used: 0, search_cost_usd: 0 },
};

describe("the request", () => {
  it("a search: POST /v1/search, the query, the count, the key as a bearer token", async () => {
    const fake = fakeOmniRoute(() => Response.json(ANSWER));
    await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 3,
      query: "bun runtime",
    });
    expect(fake.calls.length).toBe(1);
    const call = fake.calls[0] as Call;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/search");
    expect(call.contentType).toBe("application/json");
    expect(call.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(call.body)).toEqual({ query: "bun runtime", max_results: 3 });
  });

  it("a fetch: POST /v1/web/fetch, the url, markdown text, its metadata", async () => {
    const fake = fakeOmniRoute(() =>
      Response.json({ content: "Example Domain", title: "Example Domain", url: "https://x.test/" }),
    );
    await fetchPage({ backend: { apiKey: KEY, baseUrl: fake.baseUrl }, url: "https://x.test/" });
    expect(fake.calls.length).toBe(1);
    const call = fake.calls[0] as Call;
    expect(call.path).toBe("/v1/web/fetch");
    expect(call.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(call.body)).toEqual({
      url: "https://x.test/",
      format: "markdown",
      include_metadata: true,
    });
  });
});

describe("the answer", () => {
  it("a search answer: every result, the provider, the time, the cost, whether it was cached", () => {
    // The value by hand, the way the plain output reads it.
    const expected: SearchAnswer = {
      cached: false,
      costUsd: 0,
      provider: "ollama-search",
      results: [
        {
          snippet: "Bun is a fast JavaScript runtime & toolkit.",
          title: "Bun — A fast all-in-one JavaScript runtime",
          url: "https://bun.com/",
        },
        {
          snippet: "Bun v1.4.3 is out.",
          title: "Releases · oven-sh/bun",
          url: "https://github.com/oven-sh/bun/releases",
        },
      ],
      tookMs: 847,
    };
    expect(parseSearchAnswer(ANSWER)).toEqual(expected);
  });

  it("a search answer that says it was cached, and one whose fields are missing", () => {
    expect(parseSearchAnswer({ ...ANSWER, cached: true })?.cached).toBe(true);
    // A result without a title or a snippet is still a result: its url is what matters.
    expect(parseSearchAnswer({ results: [{ url: "https://x.test/" }] })).toEqual({
      cached: false,
      costUsd: 0,
      provider: "",
      results: [{ snippet: "", title: "", url: "https://x.test/" }],
      tookMs: null,
    });
    // An entry with no url is dropped: a result a person cannot open is not a result.
    expect(
      parseSearchAnswer({ results: [{ title: "no link at all" }, { url: "https://x.test/" }] }),
    ).toMatchObject({ results: [{ url: "https://x.test/" }] });
  });

  it("a search answer whose shape this version does not know: null, never a guess", () => {
    expect(parseSearchAnswer({ ok: true })).toBeNull();
    expect(parseSearchAnswer({ results: "five" })).toBeNull();
    expect(parseSearchAnswer(null)).toBeNull();
    expect(parseFetchedPage({ url: "https://x.test/" }, "https://x.test/")).toBeNull();
  });

  it("a fetched page: its text, its title, and the url the caller asked for when the answer has none", () => {
    expect(
      parseFetchedPage(
        { content: "# Example Domain\n", metadata: { title: "Example Domain" } },
        "https://example.com/",
      ),
    ).toEqual({
      content: "# Example Domain\n",
      title: "Example Domain",
      url: "https://example.com/",
    });
  });
});

describe("a request that does not answer", () => {
  it("nothing listening: the error names the address and asks whether OmniRoute runs", async () => {
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: `http://127.0.0.1:${closedPort()}` },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toMatch(
      /^cannot reach OmniRoute at http:\/\/127\.0\.0\.1:\d+ \(.+\)\. Is it running\?$/,
    );
  });

  it("no answer in time: the error says how long it waited", async () => {
    const fake = fakeOmniRoute(async () => {
      await Bun.sleep(2000);
      return Response.json(ANSWER);
    });
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
      timeoutMs: 50,
    });
    // Not "Is it running?": something took the connection, it just did not answer.
    expect("error" in said && said.error).toBe(
      `cannot reach OmniRoute at ${fake.baseUrl} (no answer within 50 ms)`,
    );
  });

  it("an answer whose body does not finish in time: it says so, and how long it waited", async () => {
    // Headers at once, then one chunk, then nothing: the body never ends.
    const fake = fakeOmniRoute(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"results": ['));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
      timeoutMs: 200,
    });
    expect("error" in said && said.error).toBe(
      `OmniRoute at ${fake.baseUrl} did not finish answering within 200 ms`,
    );
  });

  it("an answer whose body breaks off: it says so, with the reason, never as an empty answer", async () => {
    // It promises 1000 bytes and closes the connection after 13: the read fails.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write(
            'HTTP/1.1 500 Internal Server Error\r\ncontent-length: 1000\r\n\r\n{"error": {"m',
          );
          socket.end();
        },
      },
    });
    servers.push(server);
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: `http://127.0.0.1:${server.port}` },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toMatch(/^OmniRoute's answer broke off \(.+\)$/);
  });

  it("a 4xx: OmniRoute's own reason, and the key it echoed back is masked", async () => {
    const fake = fakeOmniRoute(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "bad_request",
              message: `no search provider is configured for the key ${KEY} in this request`,
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    const error = "error" in said ? said.error : "";
    expect(error).toBe(
      "OmniRoute answered HTTP 400: no search provider is configured for the key ****6789 in this request",
    );
    expect(error).not.toContain(KEY);
  });

  it("a 5xx whose answer is not JSON: the text is the reason, made one line", async () => {
    const fake = fakeOmniRoute(
      () => new Response("upstream failed:\nmaintenance", { status: 502 }),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe(
      "OmniRoute answered HTTP 502: upstream failed: maintenance",
    );
  });

  it("a reason that drives the terminal: its control characters become spaces", async () => {
    // An upstream's answer is its text, not a way to move the cursor or set colours.
    const fake = fakeOmniRoute(
      () => new Response("bad \u001b[31mred\u001b[0m\r\nreason", { status: 502 }),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe(
      "OmniRoute answered HTTP 502: bad [31mred [0m reason",
    );
  });

  it("a 5xx whose reason is long: cut, so a broken upstream cannot flood the terminal", async () => {
    // "word " (5 characters, no run of 32 key characters) 200 times: 1000 characters.
    const fake = fakeOmniRoute(() => new Response("word ".repeat(200), { status: 503 }));
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    const error = "error" in said ? said.error : "";
    expect(error.startsWith("OmniRoute answered HTTP 503: word word word ")).toBe(true);
    expect(error.endsWith("…")).toBe(true);
    // 29 characters of "OmniRoute answered HTTP 503: ", then 300 of the reason, then the cut mark.
    expect(error.length).toBe(29 + 300 + 1);
  });

  it("a redirect: not followed, so the key cannot travel to another address", async () => {
    const fake = fakeOmniRoute(
      () =>
        new Response(null, {
          headers: { location: "http://elsewhere.test/v1/search" },
          status: 302,
        }),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe(
      "OmniRoute answered a redirect (HTTP 302); it is not followed, so the key stays with the address in the gateway config. Check backends.omniroute.baseUrl.",
    );
    // One request: the client never asked the address the redirect named.
    expect(fake.calls.length).toBe(1);
  });

  it("a long reason cut next to an emoji: the cut never keeps half of it", async () => {
    // 299 characters, then an emoji (two UTF-16 units): a cut at 300 would keep its first half.
    const reason = `${"word ".repeat(59)}word\u{1F600} more`;
    const fake = fakeOmniRoute(() => new Response(reason, { status: 502 }));
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe(
      `OmniRoute answered HTTP 502: ${"word ".repeat(59)}word…`,
    );
  });

  it("a 200 whose answer is not JSON: it says so, and does not guess", async () => {
    const fake = fakeOmniRoute(() => new Response("<html>hello</html>"));
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe("OmniRoute's HTTP 200 answer is not JSON");
  });

  it("a 200 JSON answer that is not a search answer: the command's own message, not a crash", async () => {
    const fake = fakeOmniRoute(() => Response.json({ hello: "there" }));
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe(
      "OmniRoute's answer has no results list; it is not a shape this version knows",
    );
  });

  it("results in a shape this version cannot read: said so, never '0 results'", async () => {
    // A list with entries, none of which has a `url` string: a new shape, not "nothing found".
    const fake = fakeOmniRoute(() =>
      Response.json({ ...ANSWER, results: [{ link: "https://x.test/", name: "A page" }] }),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect("error" in said && said.error).toBe(
      "OmniRoute's results have no url this version can read; they are not a shape this version knows",
    );
    expect(parseSearchAnswer({ results: [{ link: "https://x.test/" }] })).toBeNull();
    // An empty list is a search that found nothing, not an unknown shape.
    expect(parseSearchAnswer({ results: [] })?.results).toEqual([]);
  });
});

describe("the key", () => {
  it("is what a request carries, and the plain answer never shows it", async () => {
    const fake = fakeOmniRoute(() => Response.json(ANSWER));
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    expect(fake.calls[0]?.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(said)).not.toContain(KEY);
  });

  it("is masked in a reason that mentions it, whatever the answer's shape", async () => {
    const fake = fakeOmniRoute(
      () => new Response(`x-api-key: ${KEY} was refused`, { status: 403 }),
    );
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    // The router's masking takes the key out, then its "key: <value>" rule masks the
    // already-masked tail a second time (a short value is masked whole). The result is
    // the key gone, however it was echoed: the command's own test repeats it for the
    // shapes a person actually sees.
    expect("error" in said && said.error).toBe(
      "OmniRoute answered HTTP 403: x-api-key: ****** was refused",
    );
    expect("error" in said && said.error).not.toContain(KEY);
  });
});

describe("a proxy in the environment", () => {
  it("is never used for OmniRoute on this machine: the key goes straight to it", async () => {
    const proxy = fakeProxy();
    servers.push(proxy);
    const fake = fakeOmniRoute(() => Response.json(ANSWER));
    await withProxyEnv(proxy.url, async () => {
      // The control: with these variables, a plain fetch to the same address does go
      // through the proxy. So the zero below proves the client chose not to.
      await fetch(`${fake.baseUrl}/control`).then((response) => response.text());
      expect(proxy.requests.length).toBe(1);
      proxy.requests.length = 0;
      const said = await searchWeb({
        backend: { apiKey: KEY, baseUrl: fake.baseUrl },
        max: 5,
        query: "bun runtime",
      });
      expect("answer" in said).toBe(true);
      // `localhost` is this machine too.
      const page = await fetchPage({
        backend: { apiKey: KEY, baseUrl: fake.baseUrl.replace("127.0.0.1", "localhost") },
        url: "https://x.test/",
      });
      expect("error" in page && page.error).toBe(
        "OmniRoute's answer has no page text; it is not a shape this version knows",
      );
    });
    expect(proxy.requests).toEqual([]);
    expect(fake.calls.map((call) => call.authorization)).toEqual([
      `Bearer ${KEY}`,
      `Bearer ${KEY}`,
    ]);
  });
});

describe("what a failure shows of the address and the reason", () => {
  it("a base URL with a user and a password: masked, never shown as it is", async () => {
    const port = closedPort();
    const said = await searchWeb({
      backend: { apiKey: KEY, baseUrl: `http://user:SECRET-pass@127.0.0.1:${port}` },
      max: 5,
      query: "bun runtime",
    });
    const error = "error" in said ? said.error : "";
    // `shownValue` shows a URL with credentials as its last four characters.
    expect(error).toStartWith(`cannot reach OmniRoute at ••••${String(port).slice(-4)} (`);
    expect(error).not.toContain("SECRET");
    expect(error).not.toContain("user:");
  });

  it("a fetch error that quotes the key: masked", async () => {
    // A key with a NUL in it: Bun refuses the header and quotes its whole value.
    const broken = `${KEY}\u0000`;
    const fake = fakeOmniRoute(() => Response.json(ANSWER));
    const said = await searchWeb({
      backend: { apiKey: broken, baseUrl: fake.baseUrl },
      max: 5,
      query: "bun runtime",
    });
    const error = "error" in said ? said.error : "";
    // The whole key is masked, its NUL included (the last four characters `maskSecrets`
    // keeps are "789" and the NUL, which the terminal sees as a space).
    expect(error).toBe(
      `cannot reach OmniRoute at ${fake.baseUrl} (Header 'Authorization' has invalid value: 'Bearer ****789 '). Is it running?`,
    );
    expect(error).not.toContain(KEY);
    expect(fake.calls.length).toBe(0);
  });
});
