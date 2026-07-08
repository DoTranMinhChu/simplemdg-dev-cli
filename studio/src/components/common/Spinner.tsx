export function Spinner({ className }: { className?: string }): React.ReactElement {
  return <span className={`spin${className ? ` ${className}` : ""}`} />;
}
