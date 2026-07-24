import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { useStreamingSession } from "../hooks/useStreamingSession";
import type { StreamingSessionService } from "../services/streaming-session-service";

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The one persistent line for a streaming session's own live filter/runtime commands (e.g. `cf request-trace`'s `/method`, `/pause`). Deliberately not `TextInputPrompt` — that component's Escape means "cancel the whole prompt," which would read as "stop this session" here; Escape/empty-Enter here just clears the line. */
function CommandBarLine(props: { placeholder?: string; onSubmit: (line: string) => void; onEmptyEnter?: () => void }) {
  const theme = useTerminalTheme();
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      if (value.trim()) {
        props.onSubmit(value.trim());
        setValue("");
      } else {
        props.onEmptyEnter?.();
      }
      return;
    }
    if (key.escape) {
      setValue("");
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setValue((current) => current + input);
    }
  });

  return (
    <Text>
      <Text color={theme.command || undefined} bold>
        {"/ "}
      </Text>
      {value || <Text color={theme.muted || undefined}>{props.placeholder ?? "Type a runtime command, Enter to run"}</Text>}
    </Text>
  );
}

/**
 * Reusable in-shell view for a long-running/tailing command (log follow,
 * HTTP watch, dev server, SSH tunnel relay, …) — the streaming-session
 * counterpart to a native workflow screen + InteractionHost. Auto-follows
 * the tail unless the user has scrolled up; caps its own rendered rows to
 * `maxVisibleRows` since Ink doesn't clip an overflowing live frame cleanly.
 */
export function StreamingOutputScreen(props: {
  service: StreamingSessionService;
  title: string;
  onDone: (success: boolean) => void;
  maxVisibleRows?: number;
  commandBar?: { placeholder?: string; onSubmit: (line: string) => void };
}) {
  const theme = useTerminalTheme();
  const { lines, truncatedCount, status, exitCode } = useStreamingSession(props.service);
  const [followTail, setFollowTail] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);

  const chromeRows = 1 + (truncatedCount > 0 ? 1 : 0) + (props.commandBar ? 1 : 0);
  const viewportRows = Math.max(3, (props.maxVisibleRows ?? 20) - chromeRows);
  const maxOffset = Math.max(0, lines.length - viewportRows);
  const effectiveOffset = followTail ? maxOffset : Math.min(scrollOffset, maxOffset);
  const visibleLines = lines.slice(effectiveOffset, effectiveOffset + viewportRows);

  const dismiss = () => props.onDone(status !== "failed");

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setFollowTail(false);
        setScrollOffset(Math.max(0, effectiveOffset - 1));
        return;
      }
      if (key.downArrow) {
        const next = Math.min(maxOffset, effectiveOffset + 1);
        setScrollOffset(next);
        if (next >= maxOffset) {
          setFollowTail(true);
        }
        return;
      }
      if (input === "f") {
        setFollowTail(true);
        return;
      }
      if (key.return && status !== "running") {
        dismiss();
      }
    },
    { isActive: !props.commandBar },
  );

  const statusSymbol = status === "running" ? "●" : status === "failed" ? "✕" : "■";
  const statusColor = status === "running" ? theme.info : status === "failed" ? theme.danger : theme.muted;
  const statusLabel =
    status === "running" ? "running" : status === "failed" ? `failed${exitCode !== undefined ? ` (exit ${exitCode})` : ""}` : "stopped";

  return (
    <Box flexDirection="column">
      <Text color={statusColor || undefined}>
        {statusSymbol} {props.title} — {statusLabel} — {formatElapsed(props.service.startedAt)}
        {!followTail ? <Text color={theme.muted || undefined}>{"  (scrolled — f to follow)"}</Text> : null}
        {status !== "running" && !props.commandBar ? <Text color={theme.muted || undefined}>{"  — Enter to dismiss"}</Text> : null}
      </Text>
      {truncatedCount > 0 ? (
        <Text color={theme.muted || undefined}>
          ↑ {truncatedCount} earlier line{truncatedCount === 1 ? "" : "s"} truncated (kept last 2,000)
        </Text>
      ) : null}
      {visibleLines.map((line) => (
        <Text key={line.id} color={line.stream === "stderr" ? theme.danger || undefined : undefined}>
          {line.tag ? <Text color={theme.muted || undefined}>[{line.tag}] </Text> : null}
          {line.text}
        </Text>
      ))}
      {props.commandBar ? (
        <CommandBarLine
          placeholder={props.commandBar.placeholder}
          onSubmit={props.commandBar.onSubmit}
          onEmptyEnter={status !== "running" ? dismiss : undefined}
        />
      ) : null}
    </Box>
  );
}
