import type { ButtonHTMLAttributes } from "react";

type TButtonVariant = "primary" | "sec" | "ghost" | "danger";
type TButtonSize = "md" | "sm";

export type TButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: TButtonVariant;
  size?: TButtonSize;
};

export function Button({ variant = "primary", size = "md", className, children, ...rest }: TButtonProps): React.ReactElement {
  const variantClass = variant === "primary" ? "" : ` ${variant}`;
  const sizeClass = size === "sm" ? " sm" : "";
  return (
    <button className={`btn${variantClass}${sizeClass}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </button>
  );
}
