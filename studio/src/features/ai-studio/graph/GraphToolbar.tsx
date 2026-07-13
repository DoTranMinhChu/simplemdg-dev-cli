import { Button } from "../../../components/common/Button";
import { IconButton } from "../../../components/common/IconButton";
import { SearchInput } from "../../../components/common/SearchInput";
import { observationTypeIcon } from "../observation-icon";
import type { TAiTurn } from "../../../api/ai-studio-api-types";

function kindLabel(kind: string): string {
  return kind.replace(/-/g, " ");
}

export function GraphToolbar({
  turns,
  selectedTurnIndex,
  onSelectTurn,
  kinds,
  hiddenKinds,
  onToggleKind,
  search,
  onSearchChange,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  turns: TAiTurn[];
  selectedTurnIndex: number;
  onSelectTurn: (index: number) => void;
  kinds: string[];
  hiddenKinds: ReadonlySet<string>;
  onToggleKind: (kind: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}): React.ReactElement {
  return (
    <div className="ai-graph-toolbar">
      <select className="select ai-select" value={selectedTurnIndex} onChange={(event) => onSelectTurn(Number(event.target.value))}>
        {turns.map((turn) => (
          <option key={turn.id} value={turn.index}>
            {turn.isContext ? "Session context" : `Turn ${turn.index}`}
          </option>
        ))}
      </select>

      <div className="ai-graph-legend">
        {kinds.map((kind) => (
          <button key={kind} type="button" className={`ai-graph-legend-chip${hiddenKinds.has(kind) ? " off" : ""}`} onClick={() => onToggleKind(kind)}>
            <span className={`ai-graph-legend-dot kind-${kind}`}>{observationTypeIcon(kind)}</span>
            {kindLabel(kind)}
          </button>
        ))}
      </div>

      <SearchInput value={search} onChange={onSearchChange} placeholder="Search nodes..." className="ai-graph-search" />

      <span className="grow" />

      <IconButton icon="plus" label="Zoom in" onClick={onZoomIn} />
      <IconButton icon="minus" label="Zoom out" onClick={onZoomOut} />
      <Button size="sm" variant="ghost" onClick={onFit}>
        Fit
      </Button>
    </div>
  );
}
