import { useEffect, useMemo, useRef, useState } from "react";
import { highlightMatch } from "../../../lib/highlight-match";
import { observationTypeIcon } from "../observation-icon";
import { deriveConversationKind, findEnclosingTurnIndex, type TConversationEntryKind } from "./conversation-model";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

type TKindFilter = "all" | TConversationEntryKind;

const FILTERS: TKindFilter[] = ["all", "user-message", "assistant-message", "tool-call", "shell-command", "file-read", "file-edit", "error"];

function snippetAround(text: string, query: string, radius = 60): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

type TMatch = { observation: TAiObservation; turnIndex: number; kind: TConversationEntryKind; snippet: string };

/** Session-local search across already-loaded turns/observations — no new API call. */
export function SearchInSession({
  open,
  onClose,
  turns,
  observations,
  onJumpToTurn,
}: {
  open: boolean;
  onClose: () => void;
  turns: TAiTurn[];
  observations: TAiObservation[];
  onJumpToTurn: (turnIndex: number) => void;
}): React.ReactElement | null {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<TKindFilter>("all");
  const [activeMatch, setActiveMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const matches = useMemo<TMatch[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    const results: TMatch[] = [];
    for (const observation of observations) {
      const kind = deriveConversationKind(observation);
      if (kindFilter !== "all" && kind !== kindFilter) continue;
      const haystack = `${observation.input}\n${observation.output}`;
      if (!haystack.toLowerCase().includes(lower)) continue;
      results.push({ observation, turnIndex: findEnclosingTurnIndex(turns, observation) ?? 0, kind, snippet: snippetAround(haystack, q) });
    }
    return results;
  }, [query, kindFilter, observations, turns]);

  useEffect(() => setActiveMatch(0), [query, kindFilter]);

  if (!open) return null;

  const goTo = (index: number): void => {
    if (!matches.length) return;
    const next = ((index % matches.length) + matches.length) % matches.length;
    setActiveMatch(next);
    onJumpToTurn(matches[next].turnIndex);
  };

  return (
    <div className="session-search">
      <div className="session-search-bar">
        <input
          ref={inputRef}
          className="session-search-input"
          placeholder="Search this session…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") goTo(activeMatch + (event.shiftKey ? -1 : 1));
            if (event.key === "Escape") onClose();
          }}
        />
        <span className="note">{matches.length ? `${activeMatch + 1} / ${matches.length}` : "0 / 0"}</span>
        <button type="button" onClick={() => goTo(activeMatch - 1)} disabled={!matches.length}>
          Prev
        </button>
        <button type="button" onClick={() => goTo(activeMatch + 1)} disabled={!matches.length}>
          Next
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="session-search-filters">
        {FILTERS.map((kind) => (
          <button key={kind} type="button" className={`chip${kindFilter === kind ? " active" : ""}`} onClick={() => setKindFilter(kind)}>
            {kind}
          </button>
        ))}
      </div>
      <div className="session-search-results">
        {matches.map((match, index) => (
          <div key={match.observation.id} className={`session-search-result${index === activeMatch ? " active" : ""}`} onClick={() => goTo(index)}>
            <span className="session-search-result-icon">{observationTypeIcon(match.kind)}</span>
            <span className="note">Turn {match.turnIndex}</span>
            <span className="session-search-result-snippet">{highlightMatch(match.snippet, query)}</span>
          </div>
        ))}
        {query.trim() && !matches.length ? <div className="note" style={{ padding: 8 }}>No matches.</div> : null}
      </div>
    </div>
  );
}
