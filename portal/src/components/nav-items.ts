import {
  ActivityIcon,
  BellDotIcon,
  CoinsIcon,
  GaugeIcon,
  ListChecksIcon,
  type LucideIcon,
  MonitorCogIcon,
  RouteIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** The line under the page's title in the header. */
  about: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Every page, in the sidebar's order. The one list: the sidebar and the header read it. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Now",
    items: [
      {
        title: "Overview",
        href: "/",
        icon: GaugeIcon,
        about: "Who answers your requests, and whether anything needs you",
      },
      {
        title: "Needs you",
        href: "/needs",
        icon: BellDotIcon,
        about: "Questions, prompts, failing checks and held updates that wait for you",
      },
      {
        title: "Usage",
        href: "/usage",
        icon: CoinsIcon,
        about: "Tokens and estimated cost, by slot, target, model and session",
      },
      {
        title: "Work",
        href: "/work",
        icon: UsersIcon,
        about: "Your Claude Code sessions",
      },
      {
        title: "Tasks",
        href: "/tasks",
        icon: ListChecksIcon,
        about: "Each project's plans, phases, tasks and subtasks, and what it still owes",
      },
      {
        title: "Flow",
        href: "/flow",
        icon: WorkflowIcon,
        about: "How the work moved: launches, parallel work and waits",
      },
    ],
  },
  {
    label: "Gateway",
    items: [
      {
        title: "Slots",
        href: "/slots",
        icon: RouteIcon,
        about: "Which model answers each kind of request",
      },
      {
        title: "Health",
        href: "/health",
        icon: ActivityIcon,
        about: "The router, its backends and its log",
      },
    ],
  },
  {
    label: "This machine",
    items: [
      {
        title: "Guard log",
        href: "/guards",
        icon: ShieldCheckIcon,
        about: "What each guard asked you or refused, and when",
      },
      {
        title: "Machine",
        href: "/machine",
        icon: MonitorCogIcon,
        about: "Versions, updates, worktrees, companions and the browser",
      },
      {
        title: "Settings",
        href: "/settings",
        icon: SlidersHorizontalIcon,
        about: "Your work flow on this machine, and each project's own",
      },
    ],
  },
];

/** The page a path belongs to: the longest `href` that starts it. */
export function navItemFor(path: string): NavItem | null {
  let found: NavItem | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const match =
        item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`);
      if (match && (found === null || item.href.length > found.href.length)) found = item;
    }
  }
  return found;
}
