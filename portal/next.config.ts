import type { NextConfig } from "next";

/**
 * The portal is a static export of the Pages Router, built with webpack (`next build
 * --webpack`): plain files the kit's own Bun server serves behind its door
 * (`.claude/rules/portal.md`).
 *
 * Why this shape: the export then holds exactly one inline script, `__NEXT_DATA__`, typed
 * `application/json` (data, never run), so the page keeps `script-src 'self'` with no hash and
 * no nonce. The App Router emits 8 to 10 inline scripts that run, and Turbopack two more.
 *
 * So no server feature is used here: no route handler, no middleware, no image optimisation,
 * no `getServerSideProps`. Every page is a client view that reads same-origin JSON.
 */
const nextConfig: NextConfig = {
  output: "export",
  // The portal is its own package inside the repo: trace from here, not from the repo's root.
  outputFileTracingRoot: __dirname,
  // `/work` is written as `work/index.html`: a plain static server finds it with no rewrite.
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // A fixed build id, so the export is byte for byte the same on every build (checked by
  // `scripts/portal-export.ts --check`). The id names `_next/static/<id>/` and appears in every
  // page's `__NEXT_DATA__`; Next makes one at random otherwise.
  generateBuildId: () => "cc-smart-dev-kit-portal",
};

export default nextConfig;
