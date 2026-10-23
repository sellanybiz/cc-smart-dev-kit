"use client";

/**
 * The one seam between the views and the router. A view links with `AppLink` and reads the
 * path with `useAppPath`; the routing shell (`src/pages/_app.tsx`) hands in its own link and
 * path. So no view imports a router, and a change of router changes the shell only.
 */

import { type ComponentType, createContext, type ReactNode, useContext } from "react";

export interface LinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
  "aria-label"?: string;
}

export interface RouterAdapter {
  /** The page's path, with no trailing slash (`/`, `/work`, `/settings/project`). */
  path: string;
  /** The page's query, as the address has it. */
  query: URLSearchParams;
  /** False until the query is known: a static page learns it on the client only. */
  ready: boolean;
  /** Writes the page's query, in place: no new history entry, no scroll. */
  setQuery: (query: URLSearchParams) => void;
  Link: ComponentType<LinkProps>;
}

function PlainLink({ children, ...props }: LinkProps) {
  return <a {...props}>{children}</a>;
}

const RouterContext = createContext<RouterAdapter>({
  path: "/",
  query: new URLSearchParams(),
  ready: true,
  setQuery: (query) => {
    const search = query.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search === "" ? "" : `?${search}`}`,
    );
  },
  Link: PlainLink,
});

export function RouterProvider({ value, children }: { value: RouterAdapter; children: ReactNode }) {
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** A path without its trailing slash, so `/work/` and `/work` are one page. */
export function normalPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "/";
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

export function useAppPath(): string {
  return useContext(RouterContext).path;
}

export function useAppQuery(): URLSearchParams {
  return useContext(RouterContext).query;
}

export function useAppQueryReady(): boolean {
  return useContext(RouterContext).ready;
}

export function useSetAppQuery(): (query: URLSearchParams) => void {
  return useContext(RouterContext).setQuery;
}

export function AppLink(props: LinkProps) {
  const { Link } = useContext(RouterContext);
  return <Link {...props} />;
}
