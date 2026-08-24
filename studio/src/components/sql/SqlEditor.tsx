import { useEffect, useRef } from "react";
import { SqlAutocompleteTextarea, type TSqlSuggestionItem } from "../common/SqlAutocompleteTextarea";

export type TSqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onRunSelected?: () => void;
  onRunAll?: () => void;
  onSave?: () => void;
  /** Keyword/table/column suggestions offered while typing — see useSqlSuggestions. */
  suggestions?: TSqlSuggestionItem[];
};

/**
 * SQL editor with a line-number gutter and an anchored-under-caret autocomplete popover (via
 * SqlAutocompleteTextarea). Isolated behind this component so a richer editor (Monaco/CodeMirror)
 * can replace the internals later without touching SqlConsoleTab.
 */
export function SqlEditor({ value, onChange, onRunSelected, onRunAll, onSave, suggestions = [] }: TSqlEditorProps): React.ReactElement {
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = value.split("\n").length;

  useEffect(() => {
    const gutter = gutterRef.current;
    if (gutter) gutter.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
  }, [lineCount]);

  return (
    <div className="editwrap">
      <div className="gutter" ref={gutterRef} />
      <SqlAutocompleteTextarea
        value={value}
        onChange={onChange}
        suggestions={suggestions}
        textareaClassName="editor"
        resize="none"
        spellCheck={false}
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onRunSelected?.();
          } else if (event.key === "F5") {
            event.preventDefault();
            onRunAll?.();
          } else if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
            event.preventDefault();
            onSave?.();
          }
        }}
      />
    </div>
  );
}
