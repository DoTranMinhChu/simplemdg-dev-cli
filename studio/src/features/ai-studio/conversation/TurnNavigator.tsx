import { useMemo, useState } from "react";
import { highlightMatch } from "../../../lib/highlight-match";
import { observationsForTurn } from "../observations-for-turn";
import { extractHeadings, turnTitle } from "./conversation-model";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

type TNavEntry = { turnIndex: number; title: string; level: number; isHeading: boolean };

function buildEntries(turns: TAiTurn[], observations: TAiObservation[]): TNavEntry[] {
  const entries: TNavEntry[] = [];
  for (const turn of turns) {
    if (turn.isContext) continue;
    entries.push({ turnIndex: turn.index, title: turnTitle(turn), level: 0, isHeading: false });
    for (const observation of observationsForTurn(observations, turn)) {
      if (observation.type !== "assistant") continue;
      for (const heading of extractHeadings(observation.output)) {
        entries.push({ turnIndex: turn.index, title: heading.text, level: heading.level, isHeading: true });
      }
    }
  }
  return entries;
}

/** Turn list doubling as the Table of Contents (turn titles + real assistant headings only — §16/§17). */
export function TurnNavigator({
  turns,
  observations,
  activeTurnIndex,
  onSelectTurn,
  onClose,
}: {
  turns: TAiTurn[];
  observations: TAiObservation[];
  activeTurnIndex: number | undefined;
  onSelectTurn: (turnIndex: number) => void;
  onClose?: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => buildEntries(turns, observations), [turns, observations]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => entry.title.toLowerCase().includes(q));
  }, [entries, query]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const indexes = [...new Set(filtered.map((entry) => entry.turnIndex))];
    const currentPos = activeTurnIndex !== undefined ? indexes.indexOf(activeTurnIndex) : -1;
    const nextPos = event.key === "ArrowDown" ? Math.min(indexes.length - 1, currentPos + 1) : Math.max(0, currentPos - 1);
    if (indexes[nextPos] !== undefined) onSelectTurn(indexes[nextPos]);
  };

  return (
    <div className="turn-nav" onKeyDown={onKeyDown} tabIndex={0}>
      <div className="turn-nav-head">
        <span>Contents</span>
        {onClose ? (
          <button type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <input className="turn-nav-search" placeholder="Search turns…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="turn-nav-list">
        {filtered.map((entry, index) => (
          <div
            key={`${entry.turnIndex}-${index}`}
            className={`turn-nav-item level-${entry.level}${!entry.isHeading && entry.turnIndex === activeTurnIndex ? " active" : ""}`}
            onClick={() => onSelectTurn(entry.turnIndex)}
          >
            {!entry.isHeading ? <span className="turn-nav-index">{entry.turnIndex}</span> : null}
            <span className="turn-nav-title">{query ? highlightMatch(entry.title, query) : entry.title}</span>
          </div>
        ))}
        {!filtered.length ? <div className="note" style={{ padding: 8 }}>No matches.</div> : null}
      </div>
    </div>
  );
}
