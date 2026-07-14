import { useEffect, useState } from "react";
import { useStdout } from "ink";

export type TTerminalSize = { columns: number; rows: number };

export function useTerminalSize(): TTerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TTerminalSize>({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => {
    if (!stdout) {
      return;
    }

    const onResize = () => {
      setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };

    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

export type TTerminalBreakpoint = "narrow" | "medium" | "wide";

export function getBreakpoint(columns: number): TTerminalBreakpoint {
  if (columns >= 120) return "wide";
  if (columns >= 80) return "medium";
  return "narrow";
}
