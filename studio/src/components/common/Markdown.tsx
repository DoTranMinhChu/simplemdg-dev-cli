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

/** Shared GFM Markdown renderer — sanitized, syntax-highlighted, used for every user/assistant message. */
export function Markdown({ text, className }: { text: string; className?: string }): React.ReactElement {
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      <ReactMarkdownCore remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[[rehypeSanitize, SCHEMA]]} components={components}>
        {text}
      </ReactMarkdownCore>
    </div>
  );
}
