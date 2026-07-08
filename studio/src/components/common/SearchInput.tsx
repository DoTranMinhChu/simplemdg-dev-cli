import { useRef } from "react";
import { Icon } from "./Icon";

export type TSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  className?: string;
  autoFocus?: boolean;
};

export function SearchInput({ value, onChange, placeholder, onEnter, className, autoFocus }: TSearchInputProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`searchbox${className ? ` ${className}` : ""}`}>
      <Icon name="search" />
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter?.();
          } else if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      <button
        type="button"
        className={`sbclr${value ? " show" : ""}`}
        title="Clear (Esc)"
        onClick={() => {
          onChange("");
          inputRef.current?.focus();
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
