"use client";

import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { LoadingState } from "@/components/states";
import { useMounted } from "@/components/status";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/** dashboard-01's frame: the inset sidebar, the site header, and the page below it. */
export function AppShell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to the page
      </a>
      <AppSidebar variant="inset" />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <div id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {/* The page itself draws on the client only. Its data comes from the client anyway,
                  and Radix writes `style` attributes (a focus group's outline, a switch's hidden
                  input) that the exported HTML must not hold under `style-src 'self'`. */}
              {mounted ? children : <LoadingState label="the page" />}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
