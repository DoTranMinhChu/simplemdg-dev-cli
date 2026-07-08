import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";

export type TIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  label: string;
  primary?: boolean;
};

/** Icon-only button. `label` is required and used as both `title` and `aria-label` for accessibility. */
export function IconButton({ icon, label, primary, className, ...rest }: TIconButtonProps): React.ReactElement {
  return (
    <button
      className={`iconbtn${primary ? " primary" : ""}${className ? ` ${className}` : ""}`}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
