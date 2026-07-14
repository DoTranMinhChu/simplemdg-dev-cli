import { useState } from "react";
import { highlightMatch } from "../../lib/highlight-match";
import { CodeBlock } from "./CodeBlock";

function CopyButton({ getText, title }: { getText: () => string; title: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="jsonview-copy"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function JsonNode({ label, value, depth, filter }: { label?: string; value: unknown; depth: number; filter: string }): React.ReactElement {
  const [open, setOpen] = useState(depth < 2);
  const isObject = value !== null && typeof value === "object";

  if (!isObject) {
    const text = typeof value === "string" ? `"${value}"` : String(value);
    return (
      <div className="jsonview-row">
        {label !== undefined ? <span className="jsonview-key">{label}: </span> : null}
        <span className="jsonview-value">{filter ? highlightMatch(text, filter) : text}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="jsonview-node">
      <div className="jsonview-row jsonview-toggle" onClick={() => setOpen((prev) => !prev)}>
        <span className={`jsonview-chev${open ? " open" : ""}`}>&rsaquo;</span>
        {label !== undefined ? <span className="jsonview-key">{label}: </span> : null}
        <span className="jsonview-brace">{isArray ? `Array(${entries.length})` : `Object(${entries.length})`}</span>
        <CopyButton title="Copy this node" getText={() => JSON.stringify(value, null, 2)} />
      </div>
      {open ? (
        <div className="jsonview-children">
          {entries.map(([key, item]) => (
            <JsonNode key={key} label={key} value={item} depth={depth + 1} filter={filter} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Hand-rolled collapsible JSON tree — pretty-print, per-node copy, and a filter that highlights matches. */
export function JsonView({ value }: { value: unknown }): React.ReactElement {
  const [filter, setFilter] = useState("");
  return (
    <div className="jsonview">
      <div className="jsonview-toolbar">
        <input className="jsonview-filter" placeholder="Filter keys/values…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <CopyButton title="Copy full JSON" getText={() => JSON.stringify(value, null, 2)} />
      </div>
      <JsonNode value={value} depth={0} filter={filter.trim()} />
    </div>
  );
}

/** Renders as a JSON tree when the text parses as JSON, otherwise falls back to a plain code block. */
export function JsonOrText({ text, language = "text" }: { text: string; language?: string }): React.ReactElement {
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") return <JsonView value={parsed} />;
    } catch {
      // Not valid JSON — fall through to plain text rendering.
    }
  }
  return <CodeBlock code={text} language={language} />;
}
