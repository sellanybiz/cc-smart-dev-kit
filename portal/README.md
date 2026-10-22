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
- `src/api/` is the one data client. `types.ts` mirrors the kit's own types and names the
  file each one comes from; a type marked "planned" names the phase that builds it. Until the
  server serves JSON, `mock.ts` (and `mock-history.ts`, `mock-d52.ts`) answer in those shapes.
- `src/components/ui/` is shadcn's code, kept close to upstream; the rest of
  `src/components/` is the portal's own.

## The content policy

The page runs under `script-src 'self'` and `style-src 'self'`. So:

- The export holds one inline script, `__NEXT_DATA__`, typed `application/json`: data, never run.
- No `style` attribute and no `<style>` element in the exported HTML. A page draws its body on
  the client only (`AppShell`), because Radix writes `style` attributes when it renders.
  Recharts, dnd-kit and Radix's positioning set styles through the CSSOM after mount, which
  the policy allows. What a library would inject as a runtime `<style>` is repeated in
  `src/styles/globals.css`, and the menus are not modal (a modal menu injects a scroll lock).
- `bun run build` ends with `scripts/csp-hashes.ts`, which writes `out/csp.json`: the hash of
  every style attribute and `<style>` body the export still holds (none today). The server
  builds `style-src-attr` and `style-src` from it.

## Mock states

Add `?mock=` to any address to see a page's other states: `loading`, `error`, `empty`,
`no-gateway`, `reconnecting`. Filters live in the address too (`?range=7d&slot=…`).
