# GI4 research: conditional requests for the lead's issue watch (2026-10-25)

What GI4 (the lead hears new issues and comments) rests on, read from GitHub's current docs and
the installed `gh` (2.102.0) on 2026-10-25, not from memory. Where a point could not be proved
from a source, it says "not verified". Behaviour of `gh api` was proved against a local fake
HTTPS server (a throwaway script in `/tmp`, not GitHub, no real API call).

## 1. Conditional requests: ETag and Last-Modified

- GitHub says: "Most endpoints return an `etag` header, and many endpoints return a
  `last-modified` header." You save the `etag`, then send it back in `if-none-match` on the next
  call to the same URL. You can send a saved `last-modified` in `if-modified-since` too. If
  nothing changed, you get `304 Not Modified`.
  <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>
- The same page says: "Use the same parameters every time you poll the same data." and "A
  different page size, page number, or filter produces a different response with a different
  `etag`." So the ETag is per URL: a changed `since`, `state`, `sort` or `direction` is a
  different request with its own ETag. GI4 must keep one saved ETag per exact URL.
- Which endpoints answer. GitHub names no endpoint list. These three are covered only by the
  general "most endpoints" wording:
  - `GET /repos/{owner}/{repo}/issues`: ETag and 304 on it: not verified for this endpoint
    from the docs; the general rule says it should. `last-modified`: not verified.
  - `GET /repos/{owner}/{repo}/issues/comments`: same, not verified per endpoint.
  - `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`: same, not verified per endpoint.
  The reference pages show no response headers for them. The first live call proves it: GI4
  must treat "no ETag in the answer" as "no conditional request, fetch normally" and never
  assume one.
- Pagination: an ETag covers one page only. A community answer (accepted, by a user whose
  GitHub staff role the page does not confirm) says: "The ETag is returned per page and is only
  applicable to the resources in that page." So a 304 on page 1 says nothing about page 2.
  <https://github.com/orgs/community/discussions/24687>. The same thread reports the `Link`
  header is missing from a 304 answer; my local proof shows the same shape for `gh` (a 304 has
  only what the server sent). Keep the `Link` of the earlier 200 if page 2 is needed.
- Other inputs to the ETag: a web article says the ETag is a hash of the body plus the
  `Accept`, `Authorization` and `Cookie` header values (reported by a search result, not read
  from GitHub's docs: not verified). Practical rule: send the same `Accept` and the same token
  on every poll, and treat the ETag as an opaque string, quotes included (a weak form
  `W/"..."` also exists; send back exactly what you saved).
- GitHub prefers webhooks to polling and asks pollers to respect `x-poll-interval`
  (best-practices page above). That header is documented for the events endpoints; whether the
  issues endpoints send it: not verified.

## 2. Rate limits

- A 304 does not count against the primary limit when the request is authorized. Exact words:
  "Making a conditional request does not count against your primary rate limit if a `304`
  response is returned" and the request must carry a correct `Authorization` header (best
  practices page above). `gh api` sends the token, so this holds for the lead.
- Secondary limits: whether a 304 counts against the secondary limit: not verified (the
  docs say nothing). The documented secondary limits are: no more than 100 concurrent
  requests, 900 points per minute for REST, 90 seconds of CPU per 60 seconds, 80
  content-generating requests per minute. Advice: make requests one after another, not at the
  same time.
  <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
- The answer when a limit is hit:
  - Primary: "you will receive a `403` or `429` response, and the `x-ratelimit-remaining`
    header will be `0`". `x-ratelimit-reset` is "The time at which the current rate limit
    window resets, in UTC epoch seconds".
  - Secondary: "you will receive a `403` or `429` response and an error message".
  - `retry-after`: "If the `retry-after` response header is present, you should not retry your
    request" until that many seconds have passed. It belongs to secondary limits.
  - With no header at all: wait at least one minute, then back off longer on each failure.
- So a limited answer is a 403 or a 429. A plain 403 is not always a rate limit (it can be a
  permission refusal): GI4 decides "rate limited" from `x-ratelimit-remaining: 0` or a
  `retry-after` header, not from the status alone. The error body text for a primary limit
  is not verified from docs; my fake server's body was my own.

## 3. The `since` filter, sorting, pull requests, pagination

From the reference pages:
<https://docs.github.com/en/rest/issues/issues#list-repository-issues> and
<https://docs.github.com/en/rest/issues/comments>.

- `GET /repos/{owner}/{repo}/issues` query: `state` (`open` default, `closed`, `all`), `sort`
  (`created` default, `updated`, `comments`), `direction` (`desc` default, `asc`), `since`,
  `labels`, `assignee`, `creator`, `mentioned`, `milestone`, `type`, `per_page` (default 30,
  max 100), `page` (default 1).
- `since`: "Only show results that were last updated after the given time." Format: "a timestamp
  in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ." The docs say "after"; whether the comparison is
  `>` or `>=` on `updated_at` is not verified. GI4 should treat it as `>=` and drop repeats by
  id, so a boundary item is never lost. For issues, `updated_at` moves on any change, so a new
  comment bumps the issue into the list (that the comment bumps it: not verified from these
  pages).
- `GET /repos/{owner}/{repo}/issues/comments` query: `sort` (`created` default, `updated`),
  `direction` ("Either asc or desc. Ignored without the sort parameter."), `since` (same
  format and words), `per_page`, `page`.
- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` query: `since`, `per_page`,
  `page` only. No `sort` or `direction`; order is by ascending id (the docs state no order
  in words for this endpoint; "ascending id" is from the fetch summary, treat as not fully
  verified).
- Pull requests: "GitHub's REST API considers every pull request an issue, but not every issue
  is a pull request." The list mixes both. "You can identify pull requests by the pull_request
  key." GI4 must skip items that have a `pull_request` key. The repo-wide issue comments list
  also carries comments on pull requests (the `issue_url` points at the pull request); to
  filter them out, look the issue up by number or compare to the issues list: not verified
  whether the comment object marks it.
- Pagination: the `link` header holds `rel="next"`, `"prev"`, `"first"`, `"last"`; only some
  appear (no `prev` on page 1; `last` may be missing). "For most endpoints, the maximum value of
  `per_page` is `100`." A larger value is silently capped, not an error. Use the URLs in the
  `link` header; query parameters in them can differ between endpoints.
  <https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api>
  The docs say nothing about sort stability between page requests: an item that changes while
  you page can move. Using `sort=updated&direction=asc&since=<cursor>` and advancing the
  cursor to the newest `updated_at` seen is the safe shape (my reasoning, not a doc claim).

## 4. `gh api`

`gh api --help` and the manual (<https://cli.github.com/manual/gh_api>), `gh` 2.102.0.

- Send a header: `-H, --header key:value` ("Add a HTTP request header in key:value format").
  Example: `gh api -H 'If-None-Match: "<etag>"' repos/{owner}/{repo}/issues`. Keep the quotes
  of the ETag value.
- Print status and headers: `-i, --include` ("Include HTTP response status line and headers in
  the output"). The headers come first on stdout, then a blank line, then the body.
- `{owner}` and `{repo}` in the endpoint fill from the current folder's repo or `GH_REPO`.
  `-f` or `-F` makes the method POST unless you add `--method GET`. For a GET with query
  parameters, put them in the URL or use `-X GET -f key=value`.
- `--paginate`: "all pages of results will sequentially be requested until there are no more
  pages of results". `--slurp` wraps all pages in one outer JSON array. `--jq` runs on each
  page.
- Exit codes. The manual's page for `gh api` says nothing about 304 or any non-2xx status. The
  general rule (`gh help exit-codes`, <https://cli.github.com/manual/gh_help_exit-codes>): 0
  on success, 1 on any failure, 2 if cancelled, 4 if authentication is required; "a particular
  command may have more exit codes".
- What was proved locally (fake TLS server, `gh` 2.102.0, `GH_HOST=localhost:<port>`,
  `SSL_CERT_FILE` for the test certificate). This is the real behaviour of this `gh` build,
  not a doc claim; recheck on a `gh` upgrade:

  | Case | Exit | stdout | stderr |
  |---|---|---|---|
  | 200 with `-i` | 0 | status line, headers (`Etag: "abc"`), blank line, body | empty |
  | 304 with `-i` (sent `If-None-Match`) | 1 | status line `HTTP/1.0 304 Not Modified` and headers, blank line | `gh: HTTP 304` |
  | 304 without `-i` | 1 | empty | `gh: HTTP 304` |
  | 403 rate limit with `-i` | 1 | status line, headers (`X-Ratelimit-Remaining: 0`, `X-Ratelimit-Reset`), body | `gh: API rate limit exceeded (HTTP 403)` (the message comes from the body) |
  | 403 without `-i` | 1 | the JSON body | same line |
  | `--paginate -i`, two pages | 0 | each page's status line, headers and body, one after the other | empty |
  | `--paginate -i`, 304 on page 1 | 1 | the 304 status line and headers | `gh: HTTP 304` |

  So with `-i` the 304 status line is on stdout, and the `gh: HTTP 304` message is on stderr.
  A 304 and a 403 both exit 1: GI4 tells them apart by the status line on stdout (parse the
  first line, not the exit code), or by the `gh: HTTP 304` text on stderr. Header names print
  in Go's canonical case (`Etag`, `X-Ratelimit-Remaining`); match them case-insensitively.
  `--paginate` combines with `-i`: every page repeats its headers. The `If-None-Match`
  header is sent on every page request (it was on page 1 in my test; whether a 304 for page 1
  stops the walk: yes, in the test it ended with exit 1). Do not use `--paginate` with one
  saved ETag: that ETag fits page 1 only. Prefer one request per page and a saved ETag for
  each page URL, or only watch page 1 with `sort=updated&direction=desc`.
- `--cache <duration>` caches a response on the machine by time, not by ETag. It does not
  replace a conditional request.
- `gh` talks to the API with the account's token (`GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth login`).
  An unauthenticated or no-token run exits 4 per the exit-code page (the "requires
  authentication" case; proved only on paper here: not verified live).

## 5. The login of the authenticated account

`gh api user --jq .login` prints the login of the account whose token `gh` uses. `user` is
`GET /user`, "the authenticated user". Proved here only as far as `--jq` printing a field of a
200 body (exit 0, no JSON quotes in the output); the real `GET /user` call was not made
(no calls to GitHub on purpose). A GitHub App installation token has no user, so `GET /user`
fails for it: not verified, but the lead normally runs with a person's `gh auth` login.

## What GI4 relies on

1. The poll is an authenticated `gh api -i -H 'If-None-Match: "<etag>"' <url>`; a 304 is free
   against the primary rate limit (documented, needs the Authorization header).
2. One saved ETag per exact URL (documented: a different filter or page gives a different
   ETag). When `since` moves, the saved ETag for the old URL is useless; a design that moves
   `since` on every change keeps an ETag only for the steady "nothing new" URL.
3. Per-endpoint ETag, `last-modified` and 304 on the three issue endpoints are not verified:
   handle a 200 with no `Etag` as an ordinary fetch.
4. `gh api -i` exits 1 on a 304 and on a 403. Tell them apart by the first stdout line (the
   status), never by the exit code. The 304 message `gh: HTTP 304` is on stderr; the status
   line is on stdout (proved on 2.102.0; recheck on a `gh` upgrade).
5. A rate limit is a 403 or 429 with `x-ratelimit-remaining: 0` (wait until
   `x-ratelimit-reset`, epoch seconds) or a `retry-after` header (wait that many seconds);
   with neither, wait at least a minute. A 403 without those is not a rate limit.
6. `since` is an ISO 8601 UTC string (`YYYY-MM-DDTHH:MM:SSZ`) on `updated_at`; treat the bound
   as inclusive and drop repeats by id. Use `sort=updated&direction=asc` for the issues list;
   the repo-wide comments list takes the same `sort`/`direction`, the per-issue one does not.
7. `/issues` returns pull requests; skip items that have the `pull_request` key. Comments on
   pull requests also appear in the repo-wide comments list: filter them (how: not verified).
8. Paging: `per_page=100`, follow `Link rel="next"`, one ETag per page; a 304 on page 1 says
   nothing about page 2. A 304 carries no `Link`.
9. Requests go one after another, never at the same time (secondary limits).
10. The lead's login comes from `gh api user --jq .login`.

## 6. Update, 2026-10-25, after the review: no `since`

The shape in § 3 (`sort=updated&direction=asc&since=<cursor>`, cursor advanced to the newest
`updated_at`) was wrong for a lead that must not lose an item. Three docs facts above show why:

- A page holds 100 at most and the reads follow no `Link rel="next"` (row 8 above). With more than
  100 updates since the cursor, the new item can sit on page 2 while the cursor already moved past
  the highest number of page 1, so it is skipped for good.
- 100 or more items with the same `updated_at` second keep `since` where it is, so the saved
  `ETag` stays valid and every later read is a `304`: the feed stalls.
- Both are easy to reach: a laptop that slept overnight, a rate-limit wait, or a bulk label.

What the code does now (`src/issues/feed.ts`): one fixed URL per list, newest first —
`state=all&sort=created&direction=desc&per_page=100` for the issues and
`sort=created&direction=desc&per_page=100` for the comments — with no `since`. A number and an id
only grow, so an item is new when it is above the highest told, and the newest page holds every new
one unless more than 100 came in between two looks (the line then says "at least"). The URL never
changes, so its `ETag` stays valid between looks. The cost: a `200` carries up to 100 items when
anything in the list changes (an edit, a new comment count), where a `since` read would carry fewer.
Not verified against real GitHub: that the repo-wide comments list accepts `sort=created` and
`direction=desc` (the docs list `sort` and `direction` for it, § 3).
