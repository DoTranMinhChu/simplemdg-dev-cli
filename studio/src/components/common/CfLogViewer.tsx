import { useMemo, useState } from "react";
import { highlightMatch } from "../../lib/highlight-match";
import { Modal } from "./Modal";
import { JsonView } from "./JsonView";
import { parseCfLogs, matchesLogQuery, summarizeLogLine, withinTimeRange } from "../../lib/cf-log-parser";
import type { TCfLogLevel, TCfLogLine } from "../../lib/cf-log-parser";

const LEVEL_ORDER: TCfLogLevel[] = ["error", "warn", "info", "debug", "unknown"];
const LEVEL_LABEL: Record<TCfLogLevel, string> = { error: "Error", warn: "Warn", info: "Info", debug: "Debug", unknown: "Other" };

function LogLine({
  line,
  filter,
  expanded,
  onToggle,
}: {
  line: TCfLogLine;
  filter: string;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { summary, expandable } = summarizeLogLine(line);
  return (
    <div className={`cflog-line level-${line.level}`}>
      <div className={`cflog-line-head${expandable ? " expandable" : ""}`} onClick={expandable ? onToggle : undefined}>
        <span className={`cflog-chev${expandable ? "" : " none"}${expanded ? " open" : ""}`}>{expandable ? "›" : ""}</span>
        {line.timestamp && <span className="cflog-ts">{line.timestamp}</span>}
        {line.source && <span className="cflog-source">[{line.source}]</span>}
        {line.stream && <span className={`cflog-stream stream-${line.stream.toLowerCase()}`}>{line.stream}</span>}
        <span className="cflog-msg">{filter ? highlightMatch(summary, filter) : summary}</span>
      </div>
      {expanded && expandable && (
        <div className="cflog-line-detail">{line.json ? <JsonView value={line.json} title="Log payload" /> : <pre className="cflog-raw">{line.message}</pre>}</div>
      )}
    </div>
  );
}

function LogBody({
  lines,
  filter,
  expandedKeys,
  onToggle,
}: {
  lines: TCfLogLine[];
  filter: string;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}): React.ReactElement {
  if (!lines.length) {
    return (
      <div className="note faint" style={{ padding: 16 }}>
        No log lines match your filter.
      </div>
    );
  }
  return (
    <div className="cflog-body">
      {lines.map((line, index) => (
        <LogLine key={`${line.raw}-${index}`} line={line} filter={filter} expanded={expandedKeys.has(line.raw)} onToggle={() => onToggle(line.raw)} />
      ))}
    </div>
  );
}

function CopyButton({ getText }: { getText: () => string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="jsonview-copy"
      onClick={() => {
        navigator.clipboard.writeText(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Color-coded, searchable viewer for `cf logs --recent` output. Each line collapses to a single
 * scannable summary (level/logger/message, or a truncated preview for non-JSON lines) so the
 * timestamp/source columns stay readable instead of being buried under a wall of wrapped raw JSON
 * — click a line to expand its full structured payload (via JsonView) or full raw text.
 *
 * `initialLevel` seeds the level filter (used by a "bulk apply to all tabs" control one level up —
 * that control changes this component's `key`, forcing a clean remount with the new starting
 * level, rather than fighting over who owns `level` state). `timeFrom`/`timeTo` (epoch ms) are
 * fully controlled from the parent since a time window is a cross-tab concern, unlike level/search
 * which stay useful as a per-tab override after a bulk level is applied. */
export function CfLogViewer({
  logs,
  title = "Logs",
  initialLevel = "all",
  timeFrom,
  timeTo,
}: {
  logs: string;
  title?: string;
  initialLevel?: TCfLogLevel | "all";
  timeFrom?: number;
  timeTo?: number;
}): React.ReactElement {
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<TCfLogLevel | "all">(initialLevel);
  const [expanded, setExpanded] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // `cf logs` emits oldest-first; reversed here so the newest line is always the first thing seen
  // without scrolling — the one place display order is decided, everything downstream (filtering,
  // counts, search) stays order-independent.
  const allLines = useMemo(() => [...parseCfLogs(logs)].reverse(), [logs]);

  const counts = useMemo(() => {
    const result: Record<TCfLogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };
    for (const line of allLines) result[line.level] += 1;
    return result;
  }, [allLines]);

  const visibleLines = useMemo(
    () => allLines.filter((line) => (level === "all" || line.level === level) && matchesLogQuery(line, filter) && withinTimeRange(line, timeFrom, timeTo)),
    [allLines, level, filter, timeFrom, timeTo],
  );

  const trimmedFilter = filter.trim();

  const toggleLine = (key: string): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="cflog-viewer">
      <div className="cflog-toolbar">
        <input className="jsonview-filter" placeholder="Search logs…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <div className="cflog-level-chips">
          <button type="button" className={`cflog-chip${level === "all" ? " active" : ""}`} onClick={() => setLevel("all")}>
            All ({allLines.length})
          </button>
          {LEVEL_ORDER.filter((lvl) => counts[lvl] > 0).map((lvl) => (
            <button key={lvl} type="button" className={`cflog-chip level-${lvl}${level === lvl ? " active" : ""}`} onClick={() => setLevel(lvl)}>
              {LEVEL_LABEL[lvl]} ({counts[lvl]})
            </button>
          ))}
        </div>
        <CopyButton getText={() => logs} />
        <button type="button" className="jsonview-copy" title="Open in a larger view" onClick={() => setExpanded(true)}>
          ⛶ Expand
        </button>
      </div>

      <div className="cflog-scroll">
        <LogBody lines={visibleLines} filter={trimmedFilter} expandedKeys={expandedKeys} onToggle={toggleLine} />
      </div>

      {expanded && (
        <Modal onClose={() => setExpanded(false)} width={1300}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button type="button" className="jsonview-copy" onClick={() => setExpanded(false)}>
              ✕ Close
            </button>
          </div>
          <div className="cflog-toolbar">
            <input className="jsonview-filter" placeholder="Search logs…" value={filter} onChange={(event) => setFilter(event.target.value)} />
            <div className="cflog-level-chips">
              <button type="button" className={`cflog-chip${level === "all" ? " active" : ""}`} onClick={() => setLevel("all")}>
                All ({allLines.length})
              </button>
              {LEVEL_ORDER.filter((lvl) => counts[lvl] > 0).map((lvl) => (
                <button key={lvl} type="button" className={`cflog-chip level-${lvl}${level === lvl ? " active" : ""}`} onClick={() => setLevel(lvl)}>
                  {LEVEL_LABEL[lvl]} ({counts[lvl]})
                </button>
              ))}
            </div>
            <CopyButton getText={() => logs} />
          </div>
          <div className="cflog-scroll" style={{ maxHeight: "72vh" }}>
            <LogBody lines={visibleLines} filter={trimmedFilter} expandedKeys={expandedKeys} onToggle={toggleLine} />
          </div>
        </Modal>
      )}
    </div>
  );
}
