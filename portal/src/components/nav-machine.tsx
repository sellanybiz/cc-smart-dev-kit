"use client";

import {
  ChevronsUpDownIcon,
  MonitorCogIcon,
  MonitorIcon,
  MoonIcon,
  SlidersHorizontalIcon,
  SunIcon,
} from "lucide-react";
import { useResource } from "@/api/hooks";
import { AppLink } from "@/components/router";
import { type Theme, useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { KIT_NAME } from "@/lib/format";

const PLATFORM_WORDS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

const THEMES: readonly { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "Same as the system", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

function isTheme(value: string): value is Theme {
  return THEMES.some((theme) => theme.value === value);
}

/** The sidebar's footer: this machine, the kit's version, and a menu with the theme. */
export function NavMachine() {
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const facts = useResource((client) => client.facts());
  const line =
    facts.status === "ready"
      ? `${KIT_NAME} ${facts.data.version} on ${PLATFORM_WORDS[facts.data.platform] ?? facts.data.platform}`
      : null;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Not modal: a modal menu locks the page's scroll with a runtime <style>, which the
            portal's content policy blocks. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                <MonitorCogIcon aria-hidden="true" />
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">This machine</span>
                {line !== null ? (
                  <span className="truncate text-xs text-muted-foreground" title={line}>
                    {line}
                  </span>
                ) : facts.status === "error" ? (
                  <span className="truncate text-xs text-muted-foreground">version not known</span>
                ) : (
                  <Skeleton className="mt-1 h-3 w-32" />
                )}
              </span>
              <ChevronsUpDownIcon className="ml-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (isTheme(value)) setTheme(value);
              }}
            >
              {THEMES.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <option.icon aria-hidden="true" />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <AppLink href="/machine">
                <MonitorCogIcon aria-hidden="true" />
                Machine details
              </AppLink>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <AppLink href="/settings">
                <SlidersHorizontalIcon aria-hidden="true" />
                Settings
              </AppLink>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
