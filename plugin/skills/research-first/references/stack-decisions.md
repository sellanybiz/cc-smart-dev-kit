# Stack Decisions: The Checklist

Read on purpose, from `../SKILL.md` § Choosing a stack or an architecture: when a new app, a
new service or a new layer has to choose its stack. Walk the areas this work touches, and give
one line to each one that does not apply.

**Every tool name here is an example, checked in November 2026, and will go stale.** Never pick
from this page. Find each area's current candidates from live sources, and judge them on the
criteria in the skill. Where the project already uses a tool, or the framework covers the job,
that is the first candidate.

## Traps that a check of current sources catches

Each of these happened to a widely used tool. Memory misses every one of them:

- **A license change.** Redis left BSD after 7.2. Redis 8 offers RSALv2, SSPLv1 or AGPLv3;
  Valkey is the BSD fork. Terraform moved to the Business Source License (BUSL); OpenTofu is the
  MPL fork. Read the license of the version you install, not the one you remember.
- **A retired project.** Kubernetes retired the ingress-nginx controller in March 2026: no
  releases, no security fixes.
- **Maintenance mode.** Auth.js now points new projects to Better Auth; Lucia is deprecated.
- **A `latest` tag that is not stable.** In November 2026 Prisma's npm `latest` tag pointed at
  8.0.0-rc.33, a release candidate; the stable line, 7, sat on the `prev` tag. Check the tags,
  not only the newest number.
- **A hijacked release.** Two axios versions shipped a remote-access trojan in March 2026.
  Pin versions in the lockfile, and read security advisories before you upgrade.
- **A stale package.** A popular package can stop releasing: kafkajs's last release was on
  2023-02-27 (checked November 2026). Check the last release date and whether issues still get
  answers.

## Frontend

- **Rendering model and framework:** single-page, server-rendered, static, or server
  components; which framework. It decides much of what follows.
- **Server state** — data the server owns that the client caches. The framework's own data
  loading first; else a query cache (TanStack Query, SWR, RTK Query). Server state and client
  state are different problems: TanStack's docs say a client store holding server data does
  the job "inefficiently".
- **Client state** — data only the UI holds. Component state first; a store (Zustand, Redux
  Toolkit, Jotai) only for state many distant parts share. Redux's docs call the bare `redux`
  core obsolete; Redux Toolkit is the form to use.
- **HTTP client:** native `fetch` first; a thin wrapper (ky, axios) when you need retries,
  timeouts, hooks or interceptors. Set a timeout either way.
- **Forms and validation:** a form library (react-hook-form) and one schema library (Zod,
  Valibot) shared by the client and the server.
- **Styling and components:** the design system, its component library, accessibility.
- **React Compiler:** on in a new React app, from its first setup
  (`/cc-smart-dev-kit:react-best-practices` § React Compiler).

## Backend and API

- **API style:** REST with an OpenAPI description (public, many client languages), GraphQL
  (clients shape their own queries), or RPC — tRPC when client and server share TypeScript
  types, gRPC or Connect when clients are generated from a schema. Generate one typed client;
  never hand-copy the types.
- **Auth:** buy (a hosted provider), use a library on your own database (Better Auth;
  Keycloak, self-hosted), or build only for a stated reason. Follow OAuth 2.0 and OpenID
  Connect, with PKCE (the proof that stops a stolen code being used); OAuth 2.1, which makes it
  mandatory, is still a draft. Decide sessions or tokens, and how a session ends.
- **Permissions:** where each check runs (in the database, in the API, both), and one home for
  the rules.
- **Rate limits and abuse:** per user, per key, per address; where the counter lives.

## Data

- **Data store:** relational by default; a document or key-value store when the access pattern
  clearly needs one. Use a supported database version: check the vendor's end-of-life table.
- **Data access:** an ORM or a query builder (Prisma, Drizzle, Kysely), and how migrations run
  and roll back. Check the release status: in November 2026 Drizzle was still 0.x with 1.0 on
  its `rc` tag, and Prisma was between majors (above).
- **Connections:** a pool (PgBouncer, or the platform's); know which session features
  transaction pooling breaks.
- **Search, files and analytics:** a search engine, object storage, a separate store for
  reports — only when the main database cannot do the job.

## Caching

- **Which layer:** HTTP caching (the browser and the CDN) first, since it spares the server all
  its work; a shared cache (Redis, Valkey, Memcached) when several instances need one copy; an
  in-process cache (lru-cache) for one instance's hot data.
- **The pattern:** cache-aside (read the cache, else the store, then fill the cache) with an
  expiry on every entry. Decide how a write invalidates it. Keep personal data out of shared
  caches (`Cache-Control: private`).
- **Never share one cache instance with a queue:** a cache evicts keys under memory pressure,
  and a queue on the same instance loses jobs. BullMQ requires the `noeviction` policy.

## Real-time

- **Transport:** server-sent events when only the server pushes (plain HTTP, reconnects by
  itself; over HTTP/1.1 a browser allows only six connections per domain); WebSockets (`ws`,
  Socket.IO) when both sides send; a managed service (Ably, Pusher) to avoid running it.
- **Across instances:** a message on one server must reach clients on the others — a pub/sub
  adapter, and sticky sessions where the library needs them.

## Queues and background work

- **Which kind:** a job queue (BullMQ on Redis, pg-boss on Postgres) for background jobs; a
  message broker (RabbitMQ, a cloud queue such as SQS) between services; an event stream
  (Kafka) for high-volume ordered events; a durable workflow engine (Temporal) for long
  multi-step processes.
- **Delivery is at least once:** a job can run twice, so every handler must be idempotent
  (safe to repeat). Decide retries, back-off, a dead-letter queue (where failed jobs wait) and
  scheduled jobs.

## Infrastructure and scaling

- **Deploy target:** containers (portable), serverless (spiky load, little to run), or the
  edge (low latency, a limited runtime). It limits which libraries work.
- **Load balancing:** a managed load balancer first; a self-hosted proxy (Envoy, Caddy, nginx,
  HAProxy, Traefik) for custom routing. Layer 7 (HTTP: routing, TLS, health checks) or layer 4
  (TCP: faster, blind to HTTP). On Kubernetes, the Gateway API is the successor to Ingress.
- **Horizontal scaling:** stateless services (sessions in a store or a token, files in object
  storage), health checks, autoscaling rules, and graceful shutdown.
- **Infrastructure as code:** one tool for every environment (OpenTofu, Terraform: check the
  license), and how secrets reach the app.
- **CI/CD:** what every change must pass before merge, and how a deploy rolls back.

## Quality and operations

- **Testing:** many fast unit tests, fewer integration tests against real dependencies
  (Testcontainers starts them in Docker), a few end-to-end tests of what users do (Playwright).
  A test runner that fits the build tool (Vitest, Jest). Check each tool's runtime minimums.
- **Observability:** instrument with OpenTelemetry (one standard for traces, metrics and logs)
  and pick the backend separately; structured logs (pino); error tracking. Check each signal's
  stability for your language.
- **Security:** dependency and secret scanning, security headers, input validation at every
  boundary, supply-chain signals (the skill's criteria).
- **Cost and limits:** what each managed service costs at ten times today's load, and its
  quotas.
