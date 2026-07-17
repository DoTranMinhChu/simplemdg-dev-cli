import { useState } from "react";

/** Collapsed by default — click the summary row to reveal `children`. For content that can get
 * very long (a big JSON blob, a long list of changes) so the page doesn't open already full of
 * scroll. Only mounts `children` once opened. */
export function Collapsible({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="collapsible">
      <div className="collapsible-head" onClick={() => setOpen((value) => !value)}>
        <span className={`collapsible-chev${open ? " open" : ""}`}>&rsaquo;</span>
        <span className="collapsible-summary">{summary}</span>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
