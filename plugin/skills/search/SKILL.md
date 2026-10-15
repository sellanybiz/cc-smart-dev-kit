---
name: search
description: Use for a quick factual lookup on the web, or to read one page's text. Runs `anymodel search` through the Bash tool, through the local gateway, so the gateway must be set up. Not for deep research, news with a date filter, or a site crawl - use the project's own research tool for those. Trigger phrases - "look up", "search the web for", "what is the latest", "fetch that page", "read this page".
---

# Web Search

`anymodel search` searches the web through the local gateway (OmniRoute, with Ollama's
web search among its providers) and prints each result's title, its URL and a short
snippet.

**Use it for:** a quick fact, a version number, one page's text.
**Not for:** deep research, news with a date filter, or a crawl of a site. Where the
project has a research tool of its own (a Tavily MCP server, say), use that one: it is
made for those.

## Run it

Through the Bash tool:

```sh
anymodel search "bun runtime latest version"     # 5 results
anymodel search "bun runtime latest version" --max 3
anymodel search --fetch https://bun.sh/blog      # one page's text
anymodel search "bun runtime" --json             # the whole answer, uncut
```

- The plain output is cut to about 2500 characters, each snippet to 300. `--json` prints
  OmniRoute's whole answer: use it when nothing may be cut.
- The gateway must be set up. "The gateway is not set up" or "no omniroute backend":
  `anymodel gateway setup --backend-key-stdin omniroute`. `--fetch` also needs a
  web-fetch provider key inside OmniRoute; without one, OmniRoute answers 400 and the
  command prints its reason.
- The command, the cost and the limits: the plugin's `docs/search.md`.
