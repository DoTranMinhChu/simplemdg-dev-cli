import type { TDeployDiffLine } from "../api/tool-studio-api-client";

function markerFor(type: TDeployDiffLine["type"]): string {
  if (type === "add") return "+";
  if (type === "remove") return "-";
  return " ";
}

/** Renders one file's pre-computed, already-collapsed diff hunks (see `buildFileDiff` in `deploy-model-job.ts`) — add/remove/context lines plus a "N unchanged lines" marker for large collapsed runs. */
export function DiffFileView({ lines }: { lines: TDeployDiffLine[] }): React.ReactElement {
  return (
    <div className="diffview">
      {lines.map((line, index) =>
        line.type === "collapsed" ? (
          <div key={index} className="diffline collapsed">
            ⋯ {line.count} unchanged line{line.count === 1 ? "" : "s"} ⋯
          </div>
        ) : (
          <div key={index} className={`diffline ${line.type}`}>
            <span className="diffline-marker">{markerFor(line.type)}</span>
            <span className="diffline-text">{line.text}</span>
          </div>
        ),
      )}
    </div>
  );
}
