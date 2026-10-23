"use client";

import { useResource } from "@/api/hooks";
import { NEEDS_REFRESH } from "@/api/refresh";
import { NAV_GROUPS, navItemFor } from "@/components/nav-items";
import { AppLink, useAppPath } from "@/components/router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/** The sidebar's pages, in their groups; the page you are on is marked for a screen reader too. */
export function NavMain() {
  const current = navItemFor(useAppPath());
  const needs = useResource((client) => client.needs(), "", NEEDS_REFRESH);
  const needsCount = needs.status === "ready" ? needs.data.items.length : 0;
  // The permission prompts could not be read: the count may be short, and says so.
  const needsUnsure = needs.status === "ready" && needs.data.note !== null;
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = current?.href === item.href;
                const badge =
                  item.href !== "/needs" || (needsCount === 0 && !needsUnsure)
                    ? null
                    : needsUnsure
                      ? `${needsCount}+`
                      : String(needsCount);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <AppLink
                        href={item.href}
                        {...(active ? { "aria-current": "page" } : {})}
                        {...(badge === null
                          ? {}
                          : {
                              "aria-label": needsUnsure
                                ? `${item.title}: ${needsCount} waiting, and the permission prompts could not be read`
                                : `${item.title}: ${badge} waiting`,
                            })}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.title}</span>
                      </AppLink>
                    </SidebarMenuButton>
                    {badge !== null && (
                      <SidebarMenuBadge
                        className="rounded-full bg-warn/15 text-warn"
                        aria-hidden="true"
                      >
                        {badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
