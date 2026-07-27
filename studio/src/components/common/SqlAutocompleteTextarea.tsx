import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { highlightMatch } from "../../lib/highlight-match";

export type TSqlAutocompleteTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  /** Column names (or any other free-text suggestions) offered while typing. */
  suggestions: string[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
};

const MAX_SUGGESTIONS = 15;

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

function filterSuggestions(suggestions: string[], token: string): string[] {
  const lower = token.toLowerCase();
  return suggestions
    .filter((suggestion) => suggestion.toLowerCase().includes(lower))
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(lower) ? 0 : 1;
      const bStarts = b.toLowerCase().startsWith(lower) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    })
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * A free-text `<textarea>` that offers an anchored-under-the-caret autocomplete popover while
 * typing, built for Audit Log Monitor's "Advanced raw SQL WHERE" mode. Nothing like this existed
 * in this codebase — `SearchableSelect` is a click-a-trigger-button, full-list combobox, not an
 * inline-typing typeahead — so this reuses its portal/outside-click-close plumbing but not its
 * trigger-button UX. Caret pixel position is found via a hidden "mirror" div: same font/padding/
 * width/wrapping as the real textarea, containing the text up to the caret plus a marker `<span>`
 * whose `getBoundingClientRect()` gives the anchor point (the standard textarea-caret-position
 * technique — the mirror never needs to be visible, only laid out).
 */
export function SqlAutocompleteTextarea({ value, onChange, suggestions, placeholder, rows = 3, disabled }: TSqlAutocompleteTextareaProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | undefined>(undefined);

  const [open, setOpen] = useState(false);
  const [tokenStart, setTokenStart] = useState(0);
  const [tokenEnd, setTokenEnd] = useState(0);
  const [token, setToken] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const recompute = (nextValue: string, caret: number): void => {
    const start = findTokenStart(nextValue, caret);
    const currentToken = nextValue.slice(start, caret);
    setTokenStart(start);
    setTokenEnd(caret);
    setToken(currentToken);
    if (!currentToken) {
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

  const acceptSuggestion = (suggestion: string): void => {
    const nextValue = value.slice(0, tokenStart) + suggestion + value.slice(tokenEnd);
    pendingCaretRef.current = tokenStart + suggestion.length;
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
    if (!open || !matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((prev) => (prev + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((prev) => (prev - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptSuggestion(matches[highlighted]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const overlayRoot = document.getElementById("overlay-root");

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        className="input sqlac-textarea"
        style={{ width: "100%", fontFamily: "var(--font-mono, monospace)", resize: "vertical" }}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={handleChange}
        onClick={handleCaretMove}
        onKeyUp={handleCaretMove}
        onSelect={handleCaretMove}
        onKeyDown={handleKeyDown}
      />
      {/* Hidden measuring mirror — laid out (for accurate metrics) but never visible. */}
      <div ref={mirrorRef} aria-hidden="true" style={{ position: "absolute", top: 0, left: -9999, visibility: "hidden" }} />

      {open && overlayRoot
        ? createPortal(
            <div ref={popoverRef} className="sqlac-popover" style={{ position: "fixed", left: position.left, top: position.top }}>
              {matches.map((suggestion, index) => (
                <div
                  key={suggestion}
                  className={`sqlac-item${index === highlighted ? " active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    acceptSuggestion(suggestion);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                >
                  {highlightMatch(suggestion, token)}
                </div>
              ))}
            </div>,
            overlayRoot,
          )
        : null}
    </div>
  );
}
