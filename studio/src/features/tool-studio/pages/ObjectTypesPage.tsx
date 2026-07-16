import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { GitLabLoginModal } from "../components/GitLabLoginModal";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TDeployTarget } from "../api/tool-studio-api-client";

export function ObjectTypesPage(): React.ReactElement {
  const targets = useAsync(() => toolStudioApi.listDeployTargets());
  const [target, setTarget] = useState<TDeployTarget | undefined>();
  const objectTypes = useAsync((targetId: string, refresh?: boolean) => toolStudioApi.getObjectTypesForTarget(targetId, refresh));
  const [showLogin, setShowLogin] = useState(false);

  const [showManualForm, setShowManualForm] = useState(false);
  const [slug, setSlug] = useState("");
  const [envObjectName, setEnvObjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pathWithNamespace, setPathWithNamespace] = useState("");
  const [role, setRole] = useState("srv");
  const addManual = useAsync(() =>
    toolStudioApi.addManualObjectType({ deployTargetId: target!.id, slug, envObjectName: envObjectName || undefined, projectId: Number(projectId), pathWithNamespace, role, defaultBranch: target!.defaultBranch }),
  );

  useEffect(() => {
    void targets.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (target) void objectTypes.run(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <div>
      {showLogin && (
        <GitLabLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            if (target) void objectTypes.run(target.id, true);
          }}
        />
      )}

      <div className="ts-header">
        <h1>Object Types</h1>
        <p className="note">
          Discovered live per GitLab group by scanning each repo's <code>_laidonBuild.yaml</code> — replaces the legacy
          tool's static 90-entry <code>object-type.json</code>, since not every customer has the same object types deployed.
        </p>
      </div>

      <div className="ts-card" style={{ maxWidth: 900 }}>
        <SearchableSelect
          value={target?.id ?? ""}
          onChange={(value) => setTarget(targets.data?.targets.find((item) => item.id === value))}
          placeholder="Select a deploy target..."
          searchPlaceholder="Search targets..."
          options={(targets.data?.targets ?? []).map((item) => ({ value: item.id, label: item.name, meta: item.gitlabGroupPath }))}
        />
      </div>

      {target && (
        <div className="ts-card" style={{ maxWidth: 1100, marginTop: 16 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Button variant="sec" size="sm" onClick={() => void objectTypes.run(target.id, true)} disabled={objectTypes.loading}>
              {objectTypes.loading ? <Spinner /> : "⟳ Rescan"}
            </Button>
            <Button variant="sec" size="sm" onClick={() => setShowManualForm((value) => !value)}>
              {showManualForm ? "Cancel" : "+ Add manual object type"}
            </Button>
          </div>

          {showManualForm && (
            <div className="ts-card" style={{ marginBottom: 12 }}>
              <div className="ts-grid-2">
                <div className="field"><label>Slug</label><input className="input" value={slug} onChange={(event) => setSlug(event.target.value)} /></div>
                <div className="field"><label>Display name</label><input className="input" value={envObjectName} onChange={(event) => setEnvObjectName(event.target.value)} /></div>
                <div className="field"><label>Project ID</label><input className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} /></div>
                <div className="field"><label>Path with namespace</label><input className="input" value={pathWithNamespace} onChange={(event) => setPathWithNamespace(event.target.value)} /></div>
                <div className="field">
                  <label>Role</label>
                  <SearchableSelect
                    value={role}
                    onChange={setRole}
                    options={[
                      { value: "db", label: "db" },
                      { value: "srv", label: "srv" },
                      { value: "srv_process", label: "srv_process" },
                      { value: "unknown", label: "unknown" },
                    ]}
                  />
                </div>
              </div>
              <Button
                disabled={!slug || !projectId || !pathWithNamespace || addManual.loading}
                onClick={async () => {
                  await addManual.run();
                  setShowManualForm(false);
                  setSlug(""); setEnvObjectName(""); setProjectId(""); setPathWithNamespace("");
                  void objectTypes.run(target.id);
                }}
              >
                {addManual.loading ? <Spinner /> : "Add"}
              </Button>
              {addManual.error && <div className="errbox" style={{ marginTop: 8 }}>{addManual.error}</div>}
            </div>
          )}

          {objectTypes.loading ? (
            <EmptyState><Spinner /> scanning...</EmptyState>
          ) : objectTypes.error || objectTypes.data?.error ? (
            <div className="errbox">
              {objectTypes.error || objectTypes.data?.error}
              <div className="row" style={{ marginTop: 8 }}>
                <Button size="sm" onClick={() => setShowLogin(true)}>Login to GitLab</Button>
              </div>
            </div>
          ) : !objectTypes.data?.objectTypes.length ? (
            <EmptyState>No object types discovered yet.</EmptyState>
          ) : (
            <div className="wiz-body">
              {objectTypes.data.objectTypes.map((item) => (
                <div key={item.slug}>
                  <div className="trow">
                    <div className="trow-main">
                      <div className="trow-title">{item.envObjectName} ({item.slug}){item.source === "manual" ? " · manual" : ""}</div>
                      <div className="trow-meta">{item.repos.map((repo) => `${repo.role}:${repo.pathWithNamespace}`).join(" · ")}</div>
                    </div>
                    {item.source === "manual" && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          await toolStudioApi.removeManualObjectType(target.id, item.slug);
                          void objectTypes.run(target.id);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
