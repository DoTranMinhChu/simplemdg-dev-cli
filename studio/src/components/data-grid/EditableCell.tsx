import { useState } from "react";

export function EditableCell({
  value,
  editable,
  edited,
  error,
  onCommit,
  onOpenInspector,
}: {
  value: unknown;
  editable: boolean;
  edited: boolean;
  error?: string;
  onCommit: (newValue: string) => void;
  onOpenInspector: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const display = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const [draft, setDraft] = useState(display);

  if (editing) {
    return (
      <td>
        <input
          className="cellinput"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            onCommit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              setEditing(false);
              onCommit(draft);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setDraft(display);
            }
          }}
        />
      </td>
    );
  }

  return (
    <td
      className={`${typeof value === "number" ? "num " : ""}${edited ? "edited " : ""}${error ? "cell-err" : ""}`}
      title={error ? `${error}\n\n${display}` : display}
      onDoubleClick={() => {
        if (editable) {
          setDraft(display);
          setEditing(true);
        } else {
          onOpenInspector();
        }
      }}
    >
      {display.length > 400 ? `${display.slice(0, 400)}…` : display}
    </td>
  );
}
