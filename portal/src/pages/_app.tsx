import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { navItemFor } from "@/components/nav-items";
import { type LinkProps, normalPath, RouterProvider } from "@/components/router";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KIT_NAME } from "@/lib/format";

function NextLink({ href, children, ...props }: LinkProps) {
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

/**
 * The routing shell: the Pages Router's only job is to mount a view under the frame. It hands
 * the views its link, its path and its query through `RouterProvider`, so no view imports
 * `next/*`.
 */
export default function PortalApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const path = normalPath(router.asPath);
  const search = router.isReady ? (router.asPath.split("?")[1]?.split("#")[0] ?? "") : "";
  // The query is known on the client only: a static page has none at build time.
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const setQuery = useCallback(
    (next: URLSearchParams) => {
      const text = next.toString();
      void router.replace(`${router.pathname}${text === "" ? "" : `?${text}`}`, undefined, {
        shallow: true,
        scroll: false,
      });
    },
    [router],
  );
  const item = navItemFor(path);
  return (
    <>
      <Head>
        <title>{item === null ? `${KIT_NAME} portal` : `${item.title} | ${KIT_NAME}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider value={{ path, query, ready: router.isReady, setQuery, Link: NextLink }}>
            <AppShell>
              <Component {...pageProps} />
            </AppShell>
          </RouterProvider>
        </TooltipProvider>
      </ThemeProvider>
    </>
  );
}
