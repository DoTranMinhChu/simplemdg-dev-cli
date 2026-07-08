import { cloneElement, type ReactElement } from "react";

/** Thin wrapper adding a native `title` tooltip to its child (matches the rest of the app's tooltip convention). */
export function Tooltip({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return cloneElement(children, { title: label });
}
