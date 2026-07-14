import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

function ActiveLine(props: { line: string; cursorCol: number; placeholder?: string; mutedColor?: string }) {
  if (props.line.length === 0) {
    return (
      <Text>
        <Text inverse> </Text>
        {props.placeholder ? <Text color={props.mutedColor || undefined}>{props.placeholder}</Text> : null}
      </Text>
    );
  }

  const before = props.line.slice(0, props.cursorCol);
  const atCursor = props.cursorCol < props.line.length ? props.line[props.cursorCol] : " ";
  const after = props.cursorCol < props.line.length ? props.line.slice(props.cursorCol + 1) : "";

  return (
    <Text>
      {before}
      <Text inverse>{atCursor}</Text>
      {after}
    </Text>
  );
}

/**
 * The one persistent composer. Enter submits; Alt+Enter (and Shift+Enter where
 * the terminal reports it distinctly — not universally reliable in raw TTY
 * mode, see USER_GUIDE) inserts a newline for multiline input. Ctrl-chords are
 * intentionally ignored here — they're owned by useGlobalShortcuts so both
 * hooks can stay active without conflicting.
 */
export function CommandInput(props: {
  history: string[];
  placeholder?: string;
  onSubmit: (value: string) => void;
  /** Typing "/" as the very first character opens the palette immediately, without waiting for Enter. */
  onSlashTrigger?: () => void;
  isActive?: boolean;
}) {
  const theme = useTerminalTheme();
  const [lines, setLines] = useState<string[]>([""]);
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(undefined);

  function replaceLine(row: number, text: string): void {
    setLines((current) => current.map((line, index) => (index === row ? text : line)));
  }

  function resetBuffer(text: string): void {
    const nextLines = text.length ? text.split("\n") : [""];
    setLines(nextLines);
    setCursorRow(nextLines.length - 1);
    setCursorCol(nextLines[nextLines.length - 1].length);
  }

  useInput(
    (input, key) => {
      if (key.ctrl || key.escape) {
        return;
      }

      const line = lines[cursorRow] ?? "";

      if (key.return && (key.meta || key.shift)) {
        const before = line.slice(0, cursorCol);
        const after = line.slice(cursorCol);
        const nextLines = [...lines.slice(0, cursorRow), before, after, ...lines.slice(cursorRow + 1)];
        setLines(nextLines);
        setCursorRow(cursorRow + 1);
        setCursorCol(0);
        return;
      }

      if (key.return) {
        const value = lines.join("\n");
        if (value.trim()) {
          props.onSubmit(value);
        }
        resetBuffer("");
        setHistoryIndex(undefined);
        return;
      }

      if (key.upArrow) {
        if (lines.length > 1 && cursorRow > 0) {
          setCursorRow(cursorRow - 1);
          return;
        }
        if (props.history.length === 0) return;
        const nextIndex = historyIndex === undefined ? props.history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        resetBuffer(props.history[nextIndex] ?? "");
        return;
      }

      if (key.downArrow) {
        if (lines.length > 1 && cursorRow < lines.length - 1) {
          setCursorRow(cursorRow + 1);
          return;
        }
        if (historyIndex === undefined) return;
        const nextIndex = historyIndex + 1;
        if (nextIndex >= props.history.length) {
          setHistoryIndex(undefined);
          resetBuffer("");
          return;
        }
        setHistoryIndex(nextIndex);
        resetBuffer(props.history[nextIndex] ?? "");
        return;
      }

      if (key.leftArrow) {
        if (cursorCol > 0) {
          setCursorCol(cursorCol - 1);
        } else if (cursorRow > 0) {
          setCursorRow(cursorRow - 1);
          setCursorCol(lines[cursorRow - 1].length);
        }
        return;
      }

      if (key.rightArrow) {
        if (cursorCol < line.length) {
          setCursorCol(cursorCol + 1);
        } else if (cursorRow < lines.length - 1) {
          setCursorRow(cursorRow + 1);
          setCursorCol(0);
        }
        return;
      }

      if (key.backspace) {
        if (cursorCol > 0) {
          replaceLine(cursorRow, line.slice(0, cursorCol - 1) + line.slice(cursorCol));
          setCursorCol(cursorCol - 1);
        } else if (cursorRow > 0) {
          const prevLine = lines[cursorRow - 1];
          const merged = prevLine + line;
          const nextLines = [...lines.slice(0, cursorRow - 1), merged, ...lines.slice(cursorRow + 1)];
          setLines(nextLines);
          setCursorRow(cursorRow - 1);
          setCursorCol(prevLine.length);
        }
        return;
      }

      if (key.delete) {
        if (cursorCol < line.length) {
          replaceLine(cursorRow, line.slice(0, cursorCol) + line.slice(cursorCol + 1));
        } else if (cursorRow < lines.length - 1) {
          const nextLine = lines[cursorRow + 1];
          const nextLines = [...lines.slice(0, cursorRow), line + nextLine, ...lines.slice(cursorRow + 2)];
          setLines(nextLines);
        }
        return;
      }

      if (input === "/" && lines.length === 1 && lines[0] === "" && props.onSlashTrigger) {
        props.onSlashTrigger();
        return;
      }

      if (input && !key.tab) {
        replaceLine(cursorRow, line.slice(0, cursorCol) + input + line.slice(cursorCol));
        setCursorCol(cursorCol + input.length);
        setHistoryIndex(undefined);
      }
    },
    { isActive: props.isActive ?? true },
  );

  return (
    <Box>
      <Text color={theme.command || undefined} bold>
        {"❯ "}
      </Text>
      <Box flexDirection="column">
        {lines.map((line, index) =>
          index === cursorRow ? (
            <ActiveLine key={index} line={line} cursorCol={cursorCol} placeholder={props.placeholder} mutedColor={theme.muted} />
          ) : (
            <Text key={index}>{line}</Text>
          ),
        )}
      </Box>
    </Box>
  );
}
