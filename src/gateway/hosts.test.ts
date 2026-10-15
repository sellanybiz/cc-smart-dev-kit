/**
 * Which machine a host is: this one, a private network, or the internet; and the fetch
 * options that keep a request to this machine away from a proxy. `privateHostKind` is
 * tested as a person meets it, through `anymodel search --fetch`
 * (src/search/command.test.ts); the proxy itself in proxy.test.ts.
 * Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { withProxyEnv } from "../testing/proxy-env";
import { directIfLoopback, isLoopbackHost, privateHostKind } from "./hosts";

describe("isLoopbackHost", () => {
  it("this machine: 127.0.0.0/8, ::1 (also IPv4-mapped), localhost", () => {
    for (const url of [
      "http://127.0.0.1:20128",
      "http://127.8.9.10/",
      "http://localhost:20128",
      "http://LOCALHOST./",
      "http://[::1]:20128",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      expect(`${url} ${isLoopbackHost(new URL(url).hostname)}`).toBe(`${url} true`);
    }
  });

  it("not this machine: other addresses and names", () => {
    for (const url of [
      "http://128.0.0.1/",
      "http://10.0.0.1/",
      "http://[::2]/",
      "http://[::]/",
      "http://[1::1]/",
      "https://api.anthropic.com/",
      "http://localhost.example.test/",
      "http://app.localhost/",
    ]) {
      expect(`${url} ${isLoopbackHost(new URL(url).hostname)}`).toBe(`${url} false`);
    }
  });
});

describe("privateHostKind", () => {
  it("null for a host on the internet", () => {
    expect(privateHostKind("example.com")).toBeNull();
    expect(privateHostKind("8.8.8.8")).toBeNull();
    expect(privateHostKind("[2001:db8::1]")).toBeNull();
  });
});

describe("directIfLoopback", () => {
  it("this machine: `proxy: false`, and the host goes on NO_PROXY once, after the person's own entries", async () => {
    await withProxyEnv("http://proxy.example.test:3128", async () => {
      process.env.NO_PROXY = "example.org, .corp.example.test";
      expect(directIfLoopback("http://127.0.0.1:20128/v1/search")).toEqual({ proxy: false });
      expect(directIfLoopback("http://127.0.0.1:20999/v1/models")).toEqual({ proxy: false });
      expect(directIfLoopback("http://[::1]:20128/v1/search")).toEqual({ proxy: false });
      expect(process.env.NO_PROXY).toBe("example.org,.corp.example.test,127.0.0.1,[::1]");
    });
  });

  it("no_proxy in effect (Bun reads it first): the host goes there", async () => {
    await withProxyEnv("http://proxy.example.test:3128", async () => {
      process.env.no_proxy = "example.org";
      expect(directIfLoopback("http://localhost:20128/v1/search")).toEqual({ proxy: false });
      expect(process.env.no_proxy).toBe("example.org,localhost");
      expect(process.env.NO_PROXY).toBe("");
    });
  });

  it("any other host: no option, so the environment's proxy settings apply; NO_PROXY unchanged", async () => {
    await withProxyEnv("http://proxy.example.test:3128", async () => {
      expect(directIfLoopback("https://api.anthropic.com/v1/messages")).toEqual({});
      expect(directIfLoopback("https://omniroute.example.test/v1/search")).toEqual({});
      expect(directIfLoopback("not a url")).toEqual({});
      expect(process.env.NO_PROXY).toBe("");
      expect(process.env.no_proxy).toBe("");
    });
  });
});
