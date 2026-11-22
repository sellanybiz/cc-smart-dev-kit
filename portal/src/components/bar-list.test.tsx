import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BarList } from "@/components/bar-list";

/** The class list of every opening tag named `tag`, in order. */
function classesOf(html: string, tag: string): string[][] {
  return [...html.matchAll(new RegExp(`<${tag} [^>]*class="([^"]*)"`, "g"))].map((match) =>
    (match[1] ?? "").split(/\s+/),
  );
}

const ROWS = [
  { key: "a", label: "opus", value: 19.49, shown: "$19.49", note: "2.1M tokens" },
  { key: "b", label: "worker", value: 0.54, shown: "$0.54", note: "3.2M tokens" },
];

test("every row shares the list's columns, so each bar starts and ends at the same x", () => {
  const html = renderToStaticMarkup(<BarList label="Cost" rows={ROWS} />);
  const [list] = classesOf(html, "ol");
  expect(list).toEqual(
    expect.arrayContaining([
      "grid",
      // A narrow card: the label on its own line, then the bar, the amount and the note.
      "grid-cols-[1fr_auto_auto]",
      "@md:grid-cols-[minmax(7rem,12rem)_1fr_auto_auto]",
    ]),
  );
  const rows = classesOf(html, "li");
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toEqual(expect.arrayContaining(["grid-cols-subgrid", "col-span-full"]));
  }
  expect(html).toContain('<span class="col-span-full truncate @md:col-span-1" title="opus">');
});

test("the amounts and the notes sit in their own right-aligned columns, with tabular figures", () => {
  const html = renderToStaticMarkup(<BarList label="Cost" rows={ROWS} />);
  expect(html).toContain('<span class="text-right tabular-nums">$19.49</span>');
  expect(html).toContain(
    '<span class="text-right text-muted-foreground tabular-nums">2.1M tokens</span>',
  );
});

test("a list with no notes has no note column", () => {
  const html = renderToStaticMarkup(
    <BarList label="Cost" rows={ROWS.map(({ note: _note, ...row }) => row)} />,
  );
  const [list] = classesOf(html, "ol");
  expect(list).toEqual(
    expect.arrayContaining(["grid-cols-[1fr_auto]", "@md:grid-cols-[minmax(7rem,12rem)_1fr_auto]"]),
  );
  expect(html).not.toContain("text-muted-foreground");
});
