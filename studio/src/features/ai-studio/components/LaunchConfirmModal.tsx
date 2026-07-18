import { useMemo, useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { setSkipLaunchConfirm } from "../launch-confirm";
import { RESUME_FLAG_DEFS, tokenizeCustomArgs } from "../resume-flags";
import type { TAiSessionLaunchCommand } from "../../../api/ai-studio-api-types";

/** Display-only quoting for the live command preview — mirrors the server's `quoteForShellIfNeeded`
 *  (ai-session-command-service.ts) closely enough for a preview line; the actual spawn always goes
 *  through the argv array built server-side from these same tokens, never this string. */
function quoteForDisplay(value: string): string {
  return /[\s'"]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

/** Shown before launching a new terminal, so the developer sees exactly what will run before it runs.
 *  Includes an "Advanced options" picker for common `--resume`-time flags (skip permissions, model
 *  override, permission mode, etc.) plus a free-text box for anything not in the curated list. */
export function LaunchConfirmModal({
  title,
  launch,
  onConfirm,
  onCancel,
}: {
  title: string;
  launch: TAiSessionLaunchCommand;
  onConfirm: (extraArgs: string[]) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [skipNextTime, setSkipNextTime] = useState(false);
  const [flagValues, setFlagValues] = useState<Record<string, string | boolean>>({});
  const [customArgsText, setCustomArgsText] = useState("");

  const extraArgs = useMemo(() => {
    const fromDefs = RESUME_FLAG_DEFS.flatMap((def) => {
      if (def.kind === "checkbox") return flagValues[def.id] ? def.toArgs() : [];
      const value = flagValues[def.id];
      return typeof value === "string" && value ? def.toArgs(value) : [];
    });
    return [...fromDefs, ...tokenizeCustomArgs(customArgsText)];
  }, [flagValues, customArgsText]);

  const previewCommand = extraArgs.length ? `${launch.command} ${extraArgs.map(quoteForDisplay).join(" ")}` : launch.command;

  return (
    <Modal onClose={onCancel} width={620}>
      <h3>{title}</h3>
      <p className="note">This opens a new terminal window and runs:</p>
      <pre className="cell-pre wrap" style={{ marginBottom: 10 }}>
        {previewCommand}
      </pre>
      <p className="note">Working directory: {launch.workingDirectory}</p>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", color: "var(--muted)" }}>
          Advanced options{extraArgs.length ? ` — ${extraArgs.length} token${extraArgs.length === 1 ? "" : "s"} active` : ""}
        </summary>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {RESUME_FLAG_DEFS.map((def) => {
            if (def.kind === "checkbox") {
              return (
                <label key={def.id} className="note" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(flagValues[def.id])}
                    onChange={(event) => setFlagValues((prev) => ({ ...prev, [def.id]: event.target.checked }))}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <code>{def.label}</code> — {def.description}
                  </span>
                </label>
              );
            }
            if (def.kind === "select") {
              return (
                <div className="field" key={def.id}>
                  <label>
                    <code>{def.label}</code> — {def.description}
                  </label>
                  <select
                    className="select"
                    value={String(flagValues[def.id] ?? "")}
                    onChange={(event) => setFlagValues((prev) => ({ ...prev, [def.id]: event.target.value }))}
                  >
                    {def.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            return (
              <div className="field" key={def.id}>
                <label>
                  <code>{def.label}</code> — {def.description}
                </label>
                <input
                  className="input"
                  placeholder={def.placeholder}
                  value={String(flagValues[def.id] ?? "")}
                  onChange={(event) => setFlagValues((prev) => ({ ...prev, [def.id]: event.target.value }))}
                />
              </div>
            );
          })}
          <div className="field">
            <label>Custom flags — anything else to pass to `claude`, space-separated</label>
            <input className="input" placeholder="e.g. --settings my-settings.json" value={customArgsText} onChange={(event) => setCustomArgsText(event.target.value)} />
          </div>
        </div>
      </details>

      <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
        <input type="checkbox" checked={skipNextTime} onChange={(event) => setSkipNextTime(event.target.checked)} />
        <span>Don&apos;t ask me again</span>
      </label>
      <div className="row right" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            if (skipNextTime) setSkipLaunchConfirm(true);
            onConfirm(extraArgs);
          }}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
