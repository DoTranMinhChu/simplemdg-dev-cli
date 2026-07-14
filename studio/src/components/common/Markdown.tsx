import { useMemo } from "react";
import ReactMarkdownCore, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { CodeBlock } from "./CodeBlock";

// Extends the default (GitHub-flavored) sanitize schema so fenced-code language classes and GFM
// task-list checkboxes survive sanitization. Everything else (scripts, event handlers, javascript:
// URLs, raw <iframe>/<style> etc.) stays blocked by rehype-sanitize's defaults.
const SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "input"],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
    li: [...(defaultSchema.attributes?.li ?? []), "className"],
    input: ["type", "checked", "disabled"],
  },
};

function textOf(children: React.ReactNode): string {
  return Array.isArray(children) ? children.map((child) => (typeof child === "string" ? child : "")).join("") : String(children ?? "");
}

const components: Components = {
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const text = textOf(children).replace(/\n$/, "");
    const language = /language-(\S+)/.exec(className ?? "")?.[1];
    const isBlock = Boolean(language) || text.includes("\n");
    if (!isBlock) return <code className="inline-code">{text}</code>;
    return <CodeBlock code={text} language={language} />;
  },
  table({ children }) {
    return (
      <div className="table-scroll">
        <table>{children}</table>
      </div>
    );
  },
  a({ href, children }) {
    const safeHref = href && !/^\s*javascript:/i.test(href) ? href : undefined;
    return (
      <a href={safeHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/** True for the file-reference links Claude Code's own responses use (`[file.ts](src/file.ts)`,
 * `[file.ts:42](src/file.ts#L42)`) — a bare relative path, not a real URL. Anything with a scheme
 * (`http:`, `mailto:`, ...) or a same-page `#anchor` is left as a normal link. */
function isLocalFileLink(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#");
}

function parseFileLink(href: string): { path: string; line?: number } {
  const [rawPath, hash] = href.split("#");
  const match = hash?.match(/^L(\d+)/);
  return { path: rawPath, line: match ? Number(match[1]) : undefined };
}

/** Builds the `a` renderer for a given `onFileLink` handler (or the plain default when there isn't one) — kept out of the static `components` object above since this one needs to close over a prop. */
function buildComponents(onFileLink: ((path: string, line?: number) => void) | undefined): Components {
  if (!onFileLink) return components;
  return {
    ...components,
    a({ href, children }) {
      if (href && isLocalFileLink(href)) {
        const { path, line } = parseFileLink(href);
        return (
          <a
            href={href}
            className="md-file-link"
            title={`Open ${path}${line ? `:${line}` : ""}`}
            onClick={(event) => {
              event.preventDefault();
              onFileLink(path, line);
            }}
          >
            {children}
          </a>
        );
      }
      const safeHref = href && !/^\s*javascript:/i.test(href) ? href : undefined;
      return (
        <a href={safeHref} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };
}

/** Best-effort markdown -> plaintext for the "Copy rendered text" action. Not a full parser — strips the common syntax marks only. */
export function stripMarkdownToPlainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/, "").replace(/```$/, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .trim();
}

/** Shared GFM Markdown renderer — sanitized, syntax-highlighted, used for every user/assistant
 * message. `onFileLink`, when given, intercepts file-reference links (see `isLocalFileLink`
 * above) instead of letting them navigate as a plain `<a href>` — which for a relative path just
 * resolves against AI Studio's own local server and goes nowhere. */
export function Markdown({ text, className, onFileLink }: { text: string; className?: string; onFileLink?: (path: string, line?: number) => void }): React.ReactElement {
  const resolvedComponents = useMemo(() => buildComponents(onFileLink), [onFileLink]);
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      <ReactMarkdownCore remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[[rehypeSanitize, SCHEMA]]} components={resolvedComponents}>
        {text}
      </ReactMarkdownCore>
    </div>
  );
}
