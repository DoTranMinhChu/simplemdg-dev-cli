import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Icon } from "../../../components/common/Icon";
import { Markdown } from "../../../components/common/Markdown";
import { pluginsApi } from "../../../api/plugins-api-client";
import { useAiStudioStore } from "../../ai-studio/state/ai-studio-store";
import { EvidenceExplorerPanel } from "../components/EvidenceExplorerPanel";
import type { TInstallScope, TPluginCatalogEntry } from "../../../api/plugins-api-types";

export function PluginDetailPanel({
  entry,
  projectRoot,
  onBack,
  onInstall,
  onChanged,
}: {
  entry: TPluginCatalogEntry;
  projectRoot: string;
  onBack: () => void;
  onInstall: (scope: TInstallScope) => void;
  onChanged: () => void;
}): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [usage, setUsage] = useState<string | undefined>();
  const [scope, setScope] = useState<TInstallScope>(entry.installed?.scope ?? "user");
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    setUsage(undefined);
    pluginsApi
      .getDetail(entry.manifest.id)
      .then((response) => setUsage(response.usage ?? undefined))
      .catch(() => setUsage(undefined));
  }, [entry.manifest.id]);

  const onRemove = async (forceCascade = false): Promise<void> => {
    setBusy(true);
    try {
      const result = await pluginsApi.remove(entry.manifest.id, projectRoot || undefined, forceCascade);
      if ("blockedBy" in result) {
        setBusy(false);
        if (window.confirm(`Other installed plugins still depend on this one: ${result.blockedBy.join(", ")}.\n\nRemove them all together?`)) {
          await onRemove(true);
        }
        return;
      }
      toast(`Removed: ${result.removedPluginIds.join(", ")}`);
      onChanged();
      onBack();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setBusy(false);
    }
  };

  const onUpdate = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await pluginsApi.update(entry.manifest.id, projectRoot || undefined);
      const versionNote = result.fromVersion === result.toVersion ? `v${result.toVersion} reinstalled` : `${result.fromVersion} -> ${result.toVersion}`;
      toast(`Updated ${result.pluginId} (${versionNote})`);
      onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setBusy(false);
    }
  };

  if (showEvidence && entry.manifest.studioExtension) {
    return (
      <EvidenceExplorerPanel pluginId={entry.manifest.id} extensionLabel={entry.manifest.studioExtension.label} projectRoot={projectRoot} onBack={() => setShowEvidence(false)} />
    );
  }

  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <a className="link" onClick={onBack}>
          &larr; Back to plugins
        </a>
        <h1>{entry.manifest.displayName}</h1>
        <div className="lede">{entry.manifest.description}</div>
      </div>

      <div className="ai-card">
        <h3>Details</h3>
        <div className="kvs">
          <div className="k">Id</div>
          <div>
            <code>{entry.manifest.id}</code>
          </div>
          <div className="k">Version</div>
          <div>{entry.manifest.version}</div>
          <div className="k">Kind</div>
          <div>{entry.manifest.kind}</div>
          <div className="k">Depends on</div>
          <div>{entry.manifest.dependsOn.length ? entry.manifest.dependsOn.join(", ") : "(none)"}</div>
          <div className="k">Status</div>
          <div>
            {entry.installed ? `Installed (${entry.installed.scope} scope, v${entry.installed.version})` : "Not installed"}
            {entry.installed && entry.installed.version !== entry.manifest.version ? (
              <span style={{ color: "var(--amber)", marginLeft: 8 }}>Update available (v{entry.manifest.version})</span>
            ) : null}
          </div>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          {!entry.installed ? (
            <>
              <select className="select" style={{ width: "auto" }} value={scope} onChange={(event) => setScope(event.target.value as TInstallScope)}>
                <option value="user">User scope (every project)</option>
                <option value="project">Project scope ({projectRoot || "set a project path above"})</option>
              </select>
              <Button disabled={scope === "project" && !projectRoot} onClick={() => onInstall(scope)}>
                Install
              </Button>
            </>
          ) : (
            <>
              <Button variant={entry.installed.version !== entry.manifest.version ? "primary" : "sec"} disabled={busy} onClick={onUpdate}>
                {busy ? "Working…" : entry.installed.version !== entry.manifest.version ? `Update to v${entry.manifest.version}` : "Re-sync / Update"}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => onRemove(false)}>
                {busy ? "Working…" : "Remove"}
              </Button>
            </>
          )}
          {entry.manifest.studioExtension && entry.installed ? (
            <Button variant="sec" onClick={() => setShowEvidence(true)}>
              <Icon name="fld" /> Open {entry.manifest.studioExtension.label} Explorer
            </Button>
          ) : null}
        </div>
      </div>

      {usage ? (
        <div className="ai-card">
          <h3>Usage</h3>
          <Markdown text={usage} />
        </div>
      ) : null}
    </div>
  );
}
