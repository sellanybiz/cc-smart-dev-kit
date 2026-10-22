"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useConnection, useResource } from "@/api/hooks";
import { navItemFor } from "@/components/nav-items";
import { useAppPath } from "@/components/router";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** The live stream's state: a quiet dot while live, a spinner and words while it reconnects. */
function ConnectionPill() {
  const connection = useConnection();
  const live = connection === "live";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        live ? "text-muted-foreground" : "border-warn/40 bg-warn/10 text-warn",
      )}
    >
      {live ? (
        <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
      ) : (
        <LoaderCircleIcon
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {live ? "Live" : "Reconnecting…"}
    </span>
  );
}

/** Where the router listens, or that there is none to name. */
function RouterPill() {
  const facts = useResource((client) => client.facts());
  if (facts.status !== "ready") return null;
  const router = facts.data.router;
  return (
    <span className="hidden h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs text-muted-foreground md:inline-flex">
      {router === null ? (
        "Gateway not set up"
      ) : (
        <>
          <span
            className={cn("font-medium", router.up ? "text-ok" : "text-bad")}
            aria-hidden="true"
          >
            {router.up ? "✓" : "✗"}
          </span>
          <span>
            Router{router.up ? "" : " down"} on{" "}
            <span className="font-mono">127.0.0.1:{router.port}</span>
          </span>
        </>
      )}
    </span>
  );
}

/** dashboard-01's site header: the sidebar's switch, the page's title, the live state. */
export function SiteHeader() {
  const item = navItemFor(useAppPath());
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-base font-medium">{item?.title ?? "Portal"}</h1>
          {item !== null && (
            <p className="hidden truncate text-sm text-muted-foreground lg:block">{item.about}</p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <RouterPill />
          <ConnectionPill />
        </div>
      </div>
    </header>
  );
}
