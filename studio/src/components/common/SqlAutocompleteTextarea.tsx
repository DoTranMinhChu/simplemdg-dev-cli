import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { highlightMatch } from "../../lib/highlight-match";

export type TSqlSuggestionKind = "keyword" | "table" | "column" | "alias";

/** A suggestion can be a bare string (legacy shape — still supported, renders with no kind badge)
 * or a richer item carrying what it is (`kind`) and an optional detail shown to its right (e.g. a
 * column's data type). Richer items let one popup mix keywords, tables, and columns while still
 * looking distinct, the way a real SQL editor's IntelliSense does. */
export type TSqlSuggestionItem = { text: string; kind?: TSqlSuggestionKind; detail?: string };
type TSuggestionInput = string | TSqlSuggestionItem;

export type TSqlAutocompleteTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  /** Column/table names, keywords, or any other free-text suggestions offered while typing. */
  suggestions: TSuggestionInput[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  spellCheck?: boolean;
  /** Extra class(es) on the positioning wrapper — use to fit this into a caller's flex layout. */
  className?: string;
  /** Extra class(es) on the `<textarea>` itself — use to pick up an existing look (e.g. "editor"). */
  textareaClassName?: string;
  /** Default "vertical" (matches the original behavior); pass "none" for a fixed-size field like
   * a single-line filter box where letting the user drag-resize would break the layout. */
  resize?: "vertical" | "none";
  /** Called for any key the popover itself doesn't consume (i.e. no suggestions are showing, or
   * the key isn't one of Up/Down/Enter/Tab/Escape) — lets a caller layer its own shortcuts
   * (submit-on-Enter, Ctrl+Enter to run, etc.) on top without fighting the popover for keystrokes. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Passed straight through — lets a caller keep a line-number gutter's scroll position in sync. */
  onScroll?: (event: React.UIEvent<HTMLTextAreaElement>) => void;
};

const MAX_SUGGESTIONS = 15;

const KIND_BADGE: Record<TSqlSuggestionKind, string> = { column: "col", table: "tbl", alias: "as", keyword: "kw" };
// Real identifiers (columns/tables) are almost always more useful than a generic keyword match,
// so they sort ahead of keywords whenever the prefix match is equally good.
const KIND_PRIORITY: Record<TSqlSuggestionKind, number> = { column: 0, alias: 0, table: 1, keyword: 2 };

/** CSS properties copied from the real textarea onto the invisible measuring mirror so its line
 * wrapping — and therefore the caret's pixel position — matches exactly. */
const MIRROR_STYLE_PROPS = [
  "boxSizing",
  "width",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "tabSize",
] as const;

function findTokenStart(value: string, caret: number): number {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) start -= 1;
  return start;
}

function normalizeSuggestion(input: TSuggestionInput): TSqlSuggestionItem {
  return typeof input === "string" ? { text: input } : input;
}

function filterSuggestions(suggestions: TSuggestionInput[], token: string): TSqlSuggestionItem[] {
  const lower = token.toLowerCase();
  const seen = new Set<string>();
  const items: TSqlSuggestionItem[] = [];
  for (const raw of suggestions) {
    const item = normalizeSuggestion(raw);
    const key = `${item.kind ?? ""}:${item.text}`;
    if (seen.has(key) || !item.text.toLowerCase().includes(lower)) continue;
    seen.add(key);
    items.push(item);
  }
  return items
    .sort((a, b) => {
      const aStarts = a.text.toLowerCase().startsWith(lower) ? 0 : 1;
      const bStarts = b.text.toLowerCase().startsWith(lower) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      const aPriority = a.kind ? KIND_PRIORITY[a.kind] : 0;
      const bPriority = b.kind ? KIND_PRIORITY[b.kind] : 0;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.text.localeCompare(b.text);
    })
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * A free-text `<textarea>` that offers an anchored-under-the-caret autocomplete popover while
 * typing. Originally built for Audit Log Monitor's "Advanced raw SQL WHERE" mode; now the shared
 * SQL-aware text field for the app — the SQL console editor and the data grid's WHERE filter box
 * both compose it too (see SqlEditor.tsx / DataGridToolbar.tsx), each supplying its own
 * `suggestions` (keywords, table names, column names) and its own `onKeyDown` for the shortcuts
 * that matter to it. Caret pixel position is found via a hidden "mirror" div: same font/padding/
 * width/wrapping as the real textarea, containing the text up to the caret plus a marker `<span>`
 * whose `getBoundingClientRect()` gives the anchor point (the standard textarea-caret-position
 * technique — the mirror never needs to be visible, only laid out).
 */
export function SqlAutocompleteTextarea({
  value,
  onChange,
  suggestions,
  placeholder,
  rows = 3,
  disabled,
  spellCheck,
  className,
  textareaClassName,
  resize = "vertical",
  onKeyDown,
  onScroll,
}: TSqlAutocompleteTextareaProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | undefined>(undefined);

  const [open, setOpen] = useState(false);
  const [tokenStart, setTokenStart] = useState(0);
  const [tokenEnd, setTokenEnd] = useState(0);
  const [token, setToken] = useState("");
  const [matches, setMatches] = useState<TSqlSuggestionItem[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const recompute = (nextValue: string, caret: number): void => {
    const start = findTokenStart(nextValue, caret);
    const currentToken = nextValue.slice(start, caret);
    // A bare "." with nothing typed after it yet still opens the popup (showing everything,
    // unfiltered) — matches typing "table." and expecting to immediately see its columns, instead
    // of needing to type the first letter before anything appears.
    const justAfterDot = nextValue[start - 1] === ".";
    setTokenStart(start);
    setTokenEnd(caret);
    setToken(currentToken);
    if (!currentToken && !justAfterDot) {
      setOpen(false);
      return;
    }
    const filtered = filterSuggestions(suggestions, currentToken);
    setMatches(filtered);
    setHighlighted(0);
    setOpen(filtered.length > 0);
  };

  // Restore caret position after accepting a suggestion — a controlled `value` re-render otherwise
  // resets the caret to the end of the textarea.
  useLayoutEffect(() => {
    if (pendingCaretRef.current === undefined) return;
    const textarea = textareaRef.current;
    if (textarea) textarea.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    pendingCaretRef.current = undefined;
  }, [value]);

  // Position the popover anchored just under the caret, via the hidden mirror technique.
  useLayoutEffect(() => {
    if (!open) return;
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) return;

    const computed = window.getComputedStyle(textarea);
    for (const prop of MIRROR_STYLE_PROPS) {
      mirror.style[prop] = computed[prop];
    }
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflowWrap = "break-word";

    mirror.textContent = "";
    mirror.appendChild(document.createTextNode(value.slice(0, tokenStart)));
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);

    const textareaRect = textarea.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();

    const popoverWidth = 260;
    const popoverHeight = popoverRef.current?.offsetHeight ?? 200;
    const left = textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft;
    const top = textareaRect.top + (markerRect.bottom - mirrorRect.top) - textarea.scrollTop + 4;

    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8)),
      top: Math.min(top, window.innerHeight - popoverHeight - 8),
    });
  }, [open, value, tokenStart]);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && (textareaRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [open]);

  const acceptSuggestion = (item: TSqlSuggestionItem): void => {
    const nextValue = value.slice(0, tokenStart) + item.text + value.slice(tokenEnd);
    pendingCaretRef.current = tokenStart + item.text.length;
    onChange(nextValue);
    setOpen(false);
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextValue = event.target.value;
    onChange(nextValue);
    recompute(nextValue, event.target.selectionStart ?? nextValue.length);
  };

  const handleCaretMove = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const target = event.currentTarget;
    recompute(target.value, target.selectionStart ?? target.value.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open && matches.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((prev) => (prev + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((prev) => (prev - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      // Ignore modifier combos (Ctrl+Enter etc.) here so a caller's own run/submit shortcut still
      // fires even while the popover happens to be open — see `onKeyDown` above.
      if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        acceptSuggestion(matches[highlighted]);
        return;
      }
    }
    onKeyDown?.(event);
  };

  const overlayRoot = document.getElementById("overlay-root");
  const wrapperClassName = className ? `sqlac-wrap ${className}` : "sqlac-wrap";
  const finalTextareaClassName = textareaClassName ? `sqlac-textarea ${textareaClassName}` : "sqlac-textarea input";

  return (
    <div className={wrapperClassName}>
      <textarea
        ref={textareaRef}
        className={finalTextareaClassName}
        style={{ resize }}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={spellCheck}
        value={value}
        onChange={handleChange}
        onClick={handleCaretMove}
        onKeyUp={handleCaretMove}
        onSelect={handleCaretMove}
        onKeyDown={handleKeyDown}
        onScroll={onScroll}
      />
      {/* Hidden measuring mirror — laid out (for accurate metrics) but never visible. */}
      <div ref={mirrorRef} aria-hidden="true" style={{ position: "absolute", top: 0, left: -9999, visibility: "hidden" }} />

      {open && overlayRoot
        ? createPortal(
            <div ref={popoverRef} className="sqlac-popover" style={{ position: "fixed", left: position.left, top: position.top }}>
              {matches.map((item) => (
                <div
                  key={`${item.kind ?? ""}:${item.text}`}
                  className={`sqlac-item${item === matches[highlighted] ? " active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    acceptSuggestion(item);
                  }}
                  onMouseEnter={() => setHighlighted(matches.indexOf(item))}
                >
                  {item.kind ? <span className={`sqlac-kind sqlac-kind-${item.kind}`}>{KIND_BADGE[item.kind]}</span> : null}
                  <span className="sqlac-text">{highlightMatch(item.text, token)}</span>
                  {item.detail ? <span className="sqlac-detail">{item.detail}</span> : null}
                </div>
              ))}
            </div>,
            overlayRoot,
          )
        : null}
    </div>
  );
}
