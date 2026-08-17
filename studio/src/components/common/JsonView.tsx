import { useEffect, useMemo, useRef, useState } from "react";
import { highlightMatch } from "../../lib/highlight-match";
import { CodeBlock } from "./CodeBlock";
import { Modal } from "./Modal";

/** Broadcast from the toolbar to every mounted JsonNode: "gen" changes on each click so nodes
 * that already applied a given command don't re-apply it (and don't fight a user's manual toggle
 * of one node in between two clicks); the effect below only reacts when gen actually moves. */
type TExpandSignal = { gen: number; open: boolean } | null;

/** Caps how many siblings a single object/array renders before offering a "show more" — keeps a
 * payload with thousands of entries (a big AI Studio tool-call output) from mounting thousands of
 * DOM rows in one go. Values already on screen are unaffected; this only paginates the tail. */
const PAGE_SIZE = 200;

function CopyButton({ getText, title }: { getText: () => string; title: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="jsonview-copy"
      title={title}
      aria-label={title}
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

/** Same "any whitespace-separated term matches" rule as highlightMatch(), applied to the whole
 * tree instead of one rendered node — so a match count is available even for terms that only
 * exist deep inside a currently-collapsed branch. */
function countFilterMatches(root: unknown, filter: string): number {
  const terms = filter.trim().split(/\s+/).filter(Boolean).map((term) => term.toLowerCase());
  if (!terms.length) return 0;
  const matches = (text: string): boolean => {
    const lower = text.toLowerCase();
    return terms.some((term) => lower.includes(term));
  };
  let count = 0;
  const walk = (node: unknown, key?: string): void => {
    if (key !== undefined && matches(key)) count += 1;
    if (node !== null && typeof node === "object") {
      if (Array.isArray(node)) node.forEach((item, index) => walk(item, String(index)));
      else Object.entries(node as Record<string, unknown>).forEach(([k, v]) => walk(v, k));
    } else if (matches(typeof node === "string" ? node : String(node))) {
      count += 1;
    }
  };
  walk(root);
  return count;
}

function JsonNode({
  label,
  value,
  depth,
  filter,
  expandSignal,
}: {
  label?: string;
  value: unknown;
  depth: number;
  filter: string;
  expandSignal: TExpandSignal;
}): React.ReactElement {
  const [open, setOpen] = useState(depth < 2);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const appliedGenRef = useRef(0);
  useEffect(() => {
    if (expandSignal && expandSignal.gen !== appliedGenRef.current) {
      appliedGenRef.current = expandSignal.gen;
      setOpen(expandSignal.open);
    }
  }, [expandSignal]);

  const isObject = value !== null && typeof value === "object";

  if (!isObject) {
    const kind = value === null ? "null" : typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : typeof value === "string" ? "string" : "other";
    const text = typeof value === "string" ? `"${value}"` : String(value);
    return (
      <div className="jsonview-row">
        {label !== undefined ? <span className="jsonview-key">{label}: </span> : null}
        <span className={`jsonview-value jsonview-value--${kind}`}>{filter ? highlightMatch(text, filter) : text}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);

  const visibleEntries = open ? entries.slice(0, visibleCount) : [];
  const remaining = entries.length - visibleEntries.length;

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
          {visibleEntries.map(([key, item]) => (
            <JsonNode key={key} label={key} value={item} depth={depth + 1} filter={filter} expandSignal={expandSignal} />
          ))}
          {remaining > 0 ? (
            <button type="button" className="jsonview-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} left)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Hand-rolled collapsible JSON tree — pretty-print, type-colored values, per-node copy, a filter
 * that highlights matches and reports how many, expand-all/collapse-all, and an optional
 * expand-to-modal for comfortably reading large/deeply-nested payloads without fighting a small
 * inline box. The filter and expand/collapse state stay in sync between inline and expanded views
 * (same state), so a search or an "expand all" started in one carries straight into the other. */
export function JsonView({ value, title = "JSON" }: { value: unknown; title?: string }): React.ReactElement {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [expandSignal, setExpandSignal] = useState<TExpandSignal>(null);
  const expandGenRef = useRef(0);

  const triggerExpand = (open: boolean) => {
    expandGenRef.current += 1;
    setExpandSignal({ gen: expandGenRef.current, open });
  };

  const trimmedFilter = filter.trim();
  const matchCount = useMemo(() => countFilterMatches(value, trimmedFilter), [value, trimmedFilter]);

  const renderToolbar = (extra?: React.ReactNode) => (
    <div className="jsonview-toolbar">
      <input className="jsonview-filter" placeholder="Filter keys/values…" value={filter} onChange={(event) => setFilter(event.target.value)} />
      {trimmedFilter ? <span className="jsonview-match-count">{matchCount === 1 ? "1 match" : `${matchCount} matches`}</span> : null}
      <button type="button" className="jsonview-toolbar-btn" onClick={() => triggerExpand(true)}>
        Expand all
      </button>
      <button type="button" className="jsonview-toolbar-btn" onClick={() => triggerExpand(false)}>
        Collapse all
      </button>
      <CopyButton title="Copy full JSON" getText={() => JSON.stringify(value, null, 2)} />
      {extra}
    </div>
  );

  return (
    <div className="jsonview">
      {renderToolbar(
        <button type="button" className="jsonview-copy" title="Open in a larger view" onClick={() => setExpanded(true)}>
          ⛶ Full view
        </button>,
      )}
      <JsonNode value={value} depth={0} filter={trimmedFilter} expandSignal={expandSignal} />

      {expanded && (
        <Modal onClose={() => setExpanded(false)} width={1100}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button type="button" className="jsonview-copy" onClick={() => setExpanded(false)}>
              ✕ Close
            </button>
          </div>
          {renderToolbar()}
          <div style={{ maxHeight: "78vh", overflow: "auto" }}>
            <JsonNode value={value} depth={0} filter={trimmedFilter} expandSignal={expandSignal} />
          </div>
        </Modal>
      )}
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
