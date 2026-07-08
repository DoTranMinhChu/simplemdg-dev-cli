import { useEffect, useRef } from "react";

export type TSqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onRunSelected?: () => void;
  onRunAll?: () => void;
  onSave?: () => void;
};

/**
 * Textarea-based SQL editor with a line-number gutter. Isolated behind this
 * component so a richer editor (Monaco/CodeMirror) can replace the internals
 * later without touching SqlConsoleTab.
 */
export function SqlEditor({ value, onChange, onRunSelected, onRunAll, onSave }: TSqlEditorProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = value.split("\n").length;

  useEffect(() => {
    const gutter = gutterRef.current;
    if (gutter) gutter.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
  }, [lineCount]);

  const syncScroll = (): void => {
    if (gutterRef.current && textareaRef.current) gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  };

  return (
    <div className="editwrap">
      <div className="gutter" ref={gutterRef} />
      <textarea
        ref={textareaRef}
        className="editor"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
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
