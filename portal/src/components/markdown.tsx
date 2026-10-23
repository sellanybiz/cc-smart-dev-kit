"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown as React elements (react-markdown): no `dangerouslySetInnerHTML`, raw HTML in the
 * text is dropped (`skipHtml`), and link addresses go through react-markdown's own URL check.
 * The elements wear the portal's type, not a prose plugin's.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-2 text-lg font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 font-medium">{children}</h5>,
  p: ({ children }) => <p className="mt-2 text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1 marker:text-muted-foreground">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} rel="noreferrer noopener" className="font-medium underline underline-offset-4">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <span
        aria-hidden="true"
        className={checked ? "mr-1.5 text-ok" : "mr-1.5 text-muted-foreground"}
      >
        {checked ? "✓" : "○"}
      </span>
    ) : null,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
