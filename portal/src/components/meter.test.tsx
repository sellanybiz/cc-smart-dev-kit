import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter, MeterBar } from "@/components/meter";

test("a meter speaks its words and draws its share as an SVG width, never a style", () => {
  const html = renderToStaticMarkup(
    <Meter value={3} max={4} className="w-full">
      3 of 4 slots
    </Meter>,
  );
  expect(html).toBe(
    '<meter class="sr-only" min="0" max="4" value="3">3 of 4 slots</meter>' +
      '<svg data-slot="meter" class="h-2.5 w-full" aria-hidden="true" preserveAspectRatio="none">' +
      '<rect width="100%" height="100%" rx="4" class="fill-muted-foreground/40"></rect>' +
      '<rect width="75%" height="100%" rx="4" class="fill-primary"></rect></svg>',
  );
});

test("the bar alone draws the same bar, with no meter to speak it", () => {
  expect(renderToStaticMarkup(<MeterBar value={1} max={4} className="w-full" />)).toBe(
    '<svg data-slot="meter" class="h-2.5 w-full" aria-hidden="true" preserveAspectRatio="none">' +
      '<rect width="100%" height="100%" rx="4" class="fill-muted-foreground/40"></rect>' +
      '<rect width="25%" height="100%" rx="4" class="fill-primary"></rect></svg>',
  );
});

test("the small size and the ok tone; a share is kept between empty and full", () => {
  const small = renderToStaticMarkup(
    <Meter value={2} max={8} size="sm" tone="ok" className="w-12">
      2 of 8 closed
    </Meter>,
  );
  expect(small).toContain('class="h-1.5 w-12"');
  expect(small).toContain('<rect width="25%" height="100%" rx="3" class="fill-ok">');

  const over = renderToStaticMarkup(
    <Meter value={120} max={100}>
      120 %
    </Meter>,
  );
  expect(over).toContain('<rect width="100%" height="100%" rx="4" class="fill-primary">');
  // Nothing to count: an empty bar, never a division by zero.
  const none = renderToStaticMarkup(
    <Meter value={0} max={0}>
      0 of 0
    </Meter>,
  );
  expect(none).toContain('<rect width="0%" height="100%" rx="4" class="fill-primary">');
});
