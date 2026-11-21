# The portal app

The portal's pages: a Next.js static export (Pages Router, built with webpack), shadcn/ui on
the `dashboard-01` layout, and tweakcn's caffeine theme. The kit's own Bun server serves the
files in `out/` behind its door (`.claude/rules/portal.md`). This package has its own
`package.json` and lockfile; the plugin's one-dependency rule is about `plugin/`, not this.

```sh
bun install
bun run dev        # next dev, on mock data
bun run build      # next build --webpack, then out/csp.json
bun run typecheck
bun run test       # the CSP hash script's tests
```

The kit ships this app's build, not its source: at the repository root, `bun run build:portal`
builds `out/` and copies it into `plugin/portal-ui/` (committed), and `bun run check:portal`
rebuilds and fails when the two differ — CI runs it. The build is reproducible: `next.config.ts`
fixes the build id (`generateBuildId`), so a second build is byte for byte the same.

## How it is put together

- `src/views/` holds every page as a plain React component; it imports no router. Links and
  the address go through `src/components/router.tsx`, which `src/pages/_app.tsx` fills.
- `src/pages/` is the routing shell: one line per page that mounts its view.
- `src/api/` is the one data client (`client.ts`; which one answers is chosen in
  `portalClient()`):
  - `wire.ts` is the server's API, type for type (one mirror of the kit's
    `src/portal/api/types.ts`; the kit's `src/portal/api/wire-mirror.test.ts` fails when the two
    drift). Change both in the same commit.
  - `adapt.ts` turns each answer into the shape its page draws (`types.ts`); a fact the server
    does not send yet is `null`, and the page says it does not know.
  - `http.ts` is the GET and the action's POST (with the page's CSRF value); `stream.ts` is the
    one `EventSource('/events')` every tab shares; `hooks.ts` reads a resource and reads it
    again on its live events (`refresh.ts` names which).
  - `mock.ts` (and `mock-history.ts`, `mock-d52.ts`) answer in the pages' shapes for `?mock=`
    and `next dev`.
- An action runs through `components/action-button.tsx` (`useAction`, `ActionResultLine`) and
  asks first through `components/confirm-dialog.tsx`, a native `<dialog>`: its result shows in
  place, never by reloading the page.
- `src/components/ui/` is shadcn's code, kept close to upstream (a portal change carries a
  comment that says why, such as the tab list's sideways scroll in `tabs.tsx`); the rest of
  `src/components/` is the portal's own.

## The content policy

The page runs under `script-src 'self'` and `style-src 'self'`. So:

- The export holds one inline script, `__NEXT_DATA__`, typed `application/json`: data, never run.
- No `style` attribute and no `<style>` element in the exported HTML. A page draws its body on
  the client only (`AppShell`), because Radix writes `style` attributes when it renders.
  Recharts, dnd-kit and Radix's positioning set styles through the CSSOM after mount, which
  the policy allows. What a library would inject as a runtime `<style>` is repeated in
  `src/styles/globals.css`.
- Nothing mounts `react-remove-scroll`, whose scroll lock is a measured `<style>`: the menus
  are not modal (`modal={false}`), and the mobile sidebar's sheet draws a plain backdrop, not
  Radix's Overlay, with its scroll lock as a static `:has()` rule in `globals.css`.
  `src/components/csp-safe.test.ts` fails on a rendered Overlay, an import of `ui/dialog` or
  `ui/popover`, a Radix Select, or a `DropdownMenu` without `modal={false}`.
- `bun run build` ends with `scripts/csp-hashes.ts`, which writes `out/csp.json`: the hash of
  every style attribute and `<style>` body the export still holds (none today). The server
  builds `style-src-attr` and `style-src` from it.

## Mock states

`bun run dev` draws every page from mock data (there is no server behind it). On the real
portal, add `?mock=` to any address to see a page's other states: `normal`, `loading`, `error`,
`empty`, `no-gateway`, `reconnecting`; the header then says "Mock data", and an action sends
nothing. Filters live in the address too (`?range=7d&slot=…`).

## Checking the built export in a browser

`bun run dev` runs without the page policy, so a runtime `<style>` that a real machine blocks
works there. To see what a machine sees, build the export, then serve it through the kit's
own server, from the repository root:

```sh
bun run --cwd portal build
bun scripts/portal-preview.ts            # or: bun scripts/portal-preview.ts <export folder>
```

It builds nothing. It serves `portal/out` with the export's `csp.json` on `127.0.0.1` at a
free port, with a new temp folder as its home, and prints the address. It runs no command and
reaches no network, so use the mock states: `/?mock=normal`, `/work/?mock=empty`. Ctrl+C stops
it and removes the temp home.
