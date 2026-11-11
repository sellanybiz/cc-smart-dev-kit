/**
 * The Tasks tab (D76), drawn from data alone: its counts, its filters, each project's card, the
 * states with nothing to show, the sidebar's entry, and the project page's card that opens it.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectListRow, TasksData, TasksProjectData } from "@/api/types";
import { NAV_GROUPS, navItemFor } from "@/components/nav-items";
import { TasksCard } from "@/components/tasks-card";
import { FULL, task, words } from "@/components/tasks-fixtures";
import { DEFAULT_FILTER, type TaskView } from "@/lib/tasks";
import { TasksPage } from "@/views/tasks";

function row(id: string, name: string): ProjectListRow {
  return {
    current: false,
    id,
    lastUsed: null,
    name,
    path: `/home/user/code/${name}`,
    setUp: true,
    source: "sessions",
    uncommitted: false,
    worktrees: 0,
  };
}

const EMPTY_FILES: TasksProjectData["tasks"]["files"] = {
  broken: 0,
  closed: 0,
  dir: ".claude/tasks",
  staleDays: 30,
  state: "ready",
  tasks: [],
};

const DATA: TasksData = {
  note: null,
  projects: [
    { project: row("p1", "my-app"), tasks: FULL },
    {
      project: row("p2", "docs-site"),
      tasks: {
        files: EMPTY_FILES,
        work: {
          more: 0,
          recentDays: 7,
          state: "ready",
          tasks: [task(1, "Fix the home page link", "in_progress")],
        },
      },
    },
    { project: row("p3", "api-service"), tasks: { files: EMPTY_FILES, work: { state: "none" } } },
    {
      project: { ...row("p4", "loose-folder"), worktrees: null },
      tasks: {
        files: { state: "unavailable", why: "not in a git checkout" },
        work: { state: "unreadable", why: "not in a git checkout" },
      },
    },
  ],
};

function page(view: Partial<TaskView> = {}, data: TasksData = DATA): string {
  return renderToStaticMarkup(
    <TasksPage
      data={data}
      view={{ ...DEFAULT_FILTER, project: null, ...view }}
      onView={() => {}}
    />,
  );
}

/** Each project card's title, in order. */
function cards(html: string): string[] {
  return [...html.matchAll(/<h2 id="[^"]*"[^>]*>(.*?)<\/h2>/g)].map((match) =>
    words(match[1] ?? ""),
  );
}

describe("the Tasks tab", () => {
  test("every project with something to show, the counts over them, and the rest named", () => {
    // No `style=` check here: the filters' Radix switch and toggle group write their own, and
    // they draw only in the browser, once the answer is there (the export holds the loading
    // state). The tree and the cards are checked without them in `tasks-card.test.tsx`.
    const html = page();
    const text = words(html);
    // The counts: 6 open in the first project and 1 in the second; one blocked; two noted.
    expect(text).toContain("Open work 7 4 in progress");
    expect(text).toContain("Blocked 1 ! waiting");
    expect(text).toContain("Non-blocking 2");
    expect(text).toContain("Owed by the projects 2 ✗ 1 block the release");
    // The project with no store has nothing to show; the unreadable one says why.
    expect(cards(html)).toEqual(["my-app", "docs-site", "loose-folder"]);
    expect(text).toContain("The task list cannot be read");
    expect(text).toContain("No tasks in 1 more project: api-service .");
    // The key to the layers and the glyphs.
    expect(text).toContain("Plan › Phase › Task");
    expect(text).toContain("○ pending ◐ in progress ✓ done – dropped");
    // Each card links to its project's page.
    expect(html).toContain('href="/settings/project?id=p1"');
  });

  test("the project picker lists every project with its open count, the picked one alone", () => {
    const all = page();
    expect(words(all)).toContain(
      "All projects my-app · 6 open docs-site · 1 open api-service · 0 open loose-folder · 0 open",
    );
    const one = page({ project: "p2" });
    expect(cards(one)).toEqual(["docs-site"]);
    expect(words(one)).toContain("Open work 1 1 in progress");
    // The picked project shows even when it has nothing: its own empty state says so.
    const none = page({ project: "p3" });
    expect(cards(none)).toEqual(["api-service"]);
    expect(words(none)).toContain("No work tasks here yet");
  });

  test("blocked only keeps the projects with a blocked task, and names the others", () => {
    const html = page({ blocked: true });
    expect(cards(html)).toEqual(["my-app"]);
    expect(words(html)).toContain("Nothing matches in 3 more projects:");
    // Each one named, a button that shows it alone.
    expect([...html.matchAll(/aria-label="Show ([^"]+) alone"/g)].map((m) => m[1])).toEqual([
      "docs-site",
      "api-service",
      "loose-folder",
    ]);
    expect(words(html)).toContain("Clear filters");
  });

  test("non-blocking only, with recent: the filters show as they are set", () => {
    const html = page({ nonBlocking: true, show: "recent" });
    expect(cards(html)).toEqual(["my-app"]);
    expect(html).toMatch(/aria-checked="true"[^>]*>|data-state="on"/);
    expect(words(html)).toContain("closed ones stay 7 days");
  });

  test("nothing matches anywhere, and an id no project has", () => {
    const quiet: TasksData = { note: null, projects: DATA.projects.slice(1, 3) };
    const text = words(page({ blocked: true, nonBlocking: true }, quiet));
    expect(text).toContain("Nothing matches the filters");
    expect(text).toContain("No blocked, non-blocking task in any project.");
    const lost = words(page({ project: "gone" }));
    expect(lost).toContain("No project on this machine has that id");
    expect(lost).toContain("Show every project");
  });

  test("no tasks in any project, and no project at all, each say where tasks come from", () => {
    const none: TasksData = { note: null, projects: [DATA.projects[2] as TasksProjectData] };
    const text = words(page({}, none));
    expect(text).toContain("No tasks in any project");
    expect(text).toContain("task_create");
    expect(text).toContain("cc-smart-dev-kit task add");
    const empty = words(
      page({}, { note: "Claude Code has saved no session records.", projects: [] }),
    );
    expect(empty).toContain("No projects yet");
    expect(empty).toContain("Claude Code has saved no session records.");
    expect(empty).toContain("Open Settings");
  });
});

describe("the ways to the Tasks tab", () => {
  test("the sidebar lists Tasks under Now, after Work", () => {
    const now = NAV_GROUPS.find((group) => group.label === "Now");
    const titles = now?.items.map((item) => item.title) ?? [];
    expect(titles.indexOf("Tasks")).toBe(titles.indexOf("Work") + 1);
    expect(navItemFor("/tasks")?.href).toBe("/tasks");
  });

  test("the project page's card opens the tab on that project, and reads while it loads", () => {
    const html = renderToStaticMarkup(<TasksCard project={row("a b", "my-app")} />);
    expect(html).not.toContain("style=");
    expect(html).toContain('href="/tasks?project=a%20b"');
    expect(words(html)).toContain("Reading the project's tasks…");
    expect(words(html)).toContain("Open in Tasks");
  });
});
