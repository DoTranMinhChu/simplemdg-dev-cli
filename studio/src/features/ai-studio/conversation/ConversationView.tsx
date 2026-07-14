import { useEffect, useMemo, useRef, useState } from "react";
import { LazyMount } from "../../../components/common/LazyMount";
import { EmptyState } from "../../../components/common/EmptyState";
import { TurnBlock } from "./TurnBlock";
import { TurnNavigator } from "./TurnNavigator";
import { SearchInSession } from "./SearchInSession";
import { ReaderMode } from "./ReaderMode";
import { ExportDialog } from "../export/ExportDialog";
import { useConversationPreferences, type TConversationDensity, type TFocusMode } from "./conversation-preferences";
import { useAiStudioStore } from "../state/ai-studio-store";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import type { TAiObservation, TAiSession, TAiTurn } from "../../../api/ai-studio-api-types";

/** Default tab — full conversation replay: turn navigator + chronological turn blocks, lazily mounted. */
export function ConversationView({
  session,
  turns,
  observations,
  focusTurnIndex,
  onFocusHandled,
  onOpenGraph,
}: {
  session: TAiSession;
  turns: TAiTurn[];
  observations: TAiObservation[];
  /** Set by other tabs (Files/Commands/Errors/Verification/Execution) to jump here and scroll to a turn. */
  focusTurnIndex?: number;
  onFocusHandled?: () => void;
  /** Jumps to the Graph tab pre-selected on a given turn. */
  onOpenGraph?: (turnIndex: number) => void;
}): React.ReactElement {
  const { preferences, setDensity, setFocusMode } = useConversationPreferences();
  const { toast } = useAiStudioStore();
  const [navigatorOpen, setNavigatorOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 1023);
  const [searchOpen, setSearchOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  const realTurns = useMemo(() => turns.filter((turn) => !turn.isContext), [turns]);

  const scrollToTurn = (turnIndex: number): void => {
    document.getElementById(`turn-${turnIndex}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** File-reference links in rendered markdown (e.g. Claude's own `[file.ts:42](src/file.ts#L42)`
   * responses) — open in VS Code, resolved against this session's cwd, instead of navigating the
   * page as a dead relative URL against AI Studio's own local server. */
  const handleFileLink = (path: string, line?: number): void => {
    aiStudioApi.openFile(session.id, path, line).then((result) => {
      if (!result.ok) toast(result.error ?? "Failed to open file.", "err");
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const targets = Array.from(container.querySelectorAll<HTMLElement>('[id^="turn-"]'));
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target as HTMLElement | undefined;
        if (top) {
          const index = Number(top.id.slice("turn-".length));
          if (Number.isFinite(index)) setActiveTurnIndex(index);
        }
      },
      { root: container, threshold: [0.1, 0.3, 0.6] },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [realTurns.length]);

  useEffect(() => {
    const match = location.hash.match(/^#turn-(\d+)$/);
    if (!match) return;
    const timer = setTimeout(() => scrollToTurn(Number(match[1])), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusTurnIndex === undefined) return;
    const timer = setTimeout(() => {
      scrollToTurn(focusTurnIndex);
      onFocusHandled?.();
    }, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTurnIndex]);

  if (!realTurns.length) return <EmptyState>No conversation turns recorded.</EmptyState>;

  return (
    <div className="conv-root">
      <div className="conv-toolbar">
        <div className="conv-toolbar-group">
          <button type="button" onClick={() => setNavigatorOpen((prev) => !prev)}>
            {navigatorOpen ? "Hide contents" : "Show contents"}
          </button>
          <select value={preferences.density} onChange={(event) => setDensity(event.target.value as TConversationDensity)} title="Density">
            <option value="readable">Readable</option>
            <option value="compact">Compact</option>
            <option value="raw">Raw</option>
          </select>
          <select value={preferences.focusMode} onChange={(event) => setFocusMode(event.target.value as TFocusMode)} title="Focus">
            <option value="combined">Conversation + Activity</option>
            <option value="conversation">Conversation only</option>
            <option value="execution">Execution only</option>
          </select>
        </div>
        <div className="conv-toolbar-group">
          <button type="button" onClick={() => setSearchOpen((prev) => !prev)}>
            Search (Ctrl+F)
          </button>
          <button type="button" onClick={() => setReaderOpen(true)}>
            Reader Mode
          </button>
          <button type="button" onClick={() => setExportOpen(true)}>
            Export
          </button>
        </div>
      </div>

      <SearchInSession open={searchOpen} onClose={() => setSearchOpen(false)} turns={turns} observations={observations} onJumpToTurn={scrollToTurn} />

      <div className={`conv-layout density-${preferences.density}`}>
        {navigatorOpen ? (
          <div className="conv-nav-wrap">
            <TurnNavigator turns={turns} observations={observations} activeTurnIndex={activeTurnIndex} onSelectTurn={scrollToTurn} onClose={() => setNavigatorOpen(false)} />
          </div>
        ) : null}
        <div className="conv-scroll" ref={scrollRef}>
          <div className="conv-column">
            {realTurns.map((turn) => (
              <LazyMount key={turn.id} id={`turn-${turn.index}`} className="turn-lazy" minHeight={220}>
                <TurnBlock turn={turn} observations={observations} focusMode={preferences.focusMode} onOpenGraph={onOpenGraph} onFileLink={handleFileLink} />
              </LazyMount>
            ))}
          </div>
        </div>
      </div>

      {readerOpen ? <ReaderMode session={session} turns={turns} observations={observations} onClose={() => setReaderOpen(false)} /> : null}
      {exportOpen ? <ExportDialog sessionId={session.id} onClose={() => setExportOpen(false)} /> : null}
    </div>
  );
}
