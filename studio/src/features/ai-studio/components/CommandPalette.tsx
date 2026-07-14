import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore, type TAiPage, type TAiWorkspaceTabKind } from "../state/ai-studio-store";
import { useSessionResume } from "../use-session-resume";

type TCommand = { id: string; label: string; hint?: string; run: () => void };

function matches(command: TCommand, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return command.label.toLowerCase().includes(needle) || Boolean(command.hint?.toLowerCase().includes(needle));
}

/**
 * Global command palette (Ctrl+Shift+P). Reuses the same store actions and useSessionResume flow
 * every other entry point uses — no separate/duplicated resume or navigation logic.
 */
export function CommandPalette({ onClose }: { onClose: () => void }): React.ReactElement | null {
  const { sessions, selectedSessionId, setCurrentPage, setActiveTabKind, refreshAll, toast, patchSession } = useAiStudioStore();
  const { requestLaunch } = useSessionResume(toast);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);

  const goToPage = (page: TAiPage): void => {
    setCurrentPage(page);
    onClose();
  };

  const openTab = (kind: TAiWorkspaceTabKind): void => {
    if (!selectedSession) return;
    setCurrentPage("sessions");
    setActiveTabKind(kind);
    onClose();
  };

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  };

  const commands = useMemo<TCommand[]>(() => {
    const list: TCommand[] = [
      { id: "nav-overview", label: "Go to Overview", run: () => goToPage("overview") },
      { id: "nav-sessions", label: "Go to Sessions", run: () => goToPage("sessions") },
      { id: "nav-projects", label: "Go to Projects", run: () => goToPage("projects") },
      { id: "nav-doctor", label: "Go to Doctor", run: () => goToPage("doctor") },
      {
        id: "refresh",
        label: "Refresh sessions",
        hint: "Re-scan ~/.claude and ~/.codex",
        run: () => {
          refreshAll();
          onClose();
        },
      },
    ];

    if (selectedSession) {
      list.push(
        {
          id: "resume",
          label: "Resume selected session",
          hint: selectedSession.title,
          run: () => {
            requestLaunch(selectedSession, "resume");
            onClose();
          },
        },
        {
          id: "continue",
          label: "Continue latest session in project",
          run: () => {
            requestLaunch(selectedSession, "continue");
            onClose();
          },
        },
        {
          id: "copy-command",
          label: "Copy resume command",
          run: async () => {
            const launch = await aiStudioApi.getLaunch(selectedSession.id);
            if (launch.commands) copy(launch.commands.resume.command, "resume command");
            onClose();
          },
        },
        {
          id: "open-terminal",
          label: "Open selected session in terminal",
          run: async () => {
            const result = await aiStudioApi.openTerminal(selectedSession.id, "resume");
            if (!result.ok) toast(result.error ?? "Failed to open a terminal.", "err");
            onClose();
          },
        },
        {
          id: "open-project",
          label: "Open project folder",
          run: async () => {
            const result = await aiStudioApi.openProject(selectedSession.id);
            if (!result.ok) toast(result.error ?? "Failed to open the project folder.", "err");
            onClose();
          },
        },
        {
          id: "open-vscode",
          label: "Open project in VS Code",
          run: async () => {
            const result = await aiStudioApi.openVsCode(selectedSession.id);
            if (!result.ok) toast(result.error ?? "VS Code command-line launcher not found.", "err");
            onClose();
          },
        },
        { id: "open-conversation", label: "Open Conversation tab", run: () => openTab("conversation") },
        { id: "open-execution", label: "Open Execution tab", run: () => openTab("execution") },
        { id: "open-graph", label: "Open Graph tab", run: () => openTab("graph") },
        { id: "open-timeline", label: "Open Timeline tab", run: () => openTab("timeline") },
        { id: "open-overview-tab", label: "Open session Overview tab", run: () => openTab("overview") },
        {
          id: "pin",
          label: selectedSession.pinned ? "Unpin session" : "Pin session",
          run: () => {
            const next = !selectedSession.pinned;
            patchSession(selectedSession.id, { pinned: next });
            aiStudioApi.setPinned(selectedSession.id, next);
            onClose();
          },
        },
        {
          id: "export",
          label: "Export session",
          run: () => {
            window.open(aiStudioApi.exportUrl(selectedSession.id), "_blank", "noopener,noreferrer");
            onClose();
          },
        },
      );
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession, sessions]);

  const filtered = commands.filter((command) => matches(command, query));

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        filtered[activeIndex]?.run();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, activeIndex, onClose]);

  const overlayRoot = document.getElementById("overlay-root");
  if (!overlayRoot) return null;

  return createPortal(
    <div className="ai-palette-backdrop" onClick={onClose}>
      <div className="ai-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="ai-palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command..."
        />
        <div className="ai-palette-list">
          {filtered.length ? (
            filtered.map((command, index) => (
              <div key={command.id} className={`ai-palette-item${index === activeIndex ? " active" : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => command.run()}>
                <span>{command.label}</span>
                {command.hint ? <span className="ai-palette-hint">{command.hint.slice(0, 60)}</span> : null}
              </div>
            ))
          ) : (
            <div className="ai-palette-empty">No matching commands.</div>
          )}
        </div>
      </div>
    </div>,
    overlayRoot,
  );
}
