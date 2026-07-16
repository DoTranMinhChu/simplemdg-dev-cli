import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { GitLabLoginModal } from "../components/GitLabLoginModal";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TGitLabGroup } from "../api/tool-studio-api-client";

export function NpmrcRegistryPage(): React.ReactElement {
  // Force a live GitLab fetch (see DeployModelPage's CreateDeployTargetForm for why): this list is
  // opened deliberately/infrequently, so a stale cached empty result silently masking a real
  // "not logged in" error is worse than the extra round-trip.
  const groups = useAsync(() => toolStudioApi.getGitlabGroups(true));
  const [group, setGroup] = useState<TGitLabGroup | undefined>();
  const [pinInput, setPinInput] = useState("");
  const [showLogin, setShowLogin] = useState(false);

  const resolved = useAsync((groupId: number, groupPath: string) => toolStudioApi.resolveNpmrcPackageId(groupId, groupPath));

  useEffect(() => {
    void groups.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (group) void resolved.run(group.id, group.full_path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  return (
    <div>
      {showLogin && (
        <GitLabLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            void groups.run();
          }}
        />
      )}

      <div className="ts-header">
        <h1>npmrc / Registry</h1>
        <p className="note">
          Resolves which GitLab project backs a group's <code>@scope</code> npm registry (used for <code>.npmrc</code>
          generation) — auto-guessed from the group's projects, with a manual pin that survives future re-scans.
        </p>
      </div>

      <div className="ts-card" style={{ maxWidth: 900 }}>
        {groups.loading ? (
          <Spinner />
        ) : groups.error || groups.data?.error ? (
          <div className="errbox">
            {groups.error || groups.data?.error}
            <div className="row" style={{ marginTop: 8 }}>
              <Button size="sm" onClick={() => setShowLogin(true)}>Login to GitLab</Button>
            </div>
          </div>
        ) : (
          <SearchableSelect
            value={group ? String(group.id) : ""}
            onChange={(value) => setGroup(groups.data?.groups.find((item) => String(item.id) === value))}
            placeholder="Select a GitLab group..."
            searchPlaceholder="Search groups..."
            options={(groups.data?.groups ?? []).map((item) => ({ value: String(item.id), label: item.full_path }))}
          />
        )}
      </div>

      {group && (
        <div className="ts-card" style={{ maxWidth: 1000, marginTop: 16 }}>
          {resolved.loading ? (
            <Spinner />
          ) : resolved.error || resolved.data?.error ? (
            <div className="errbox">{resolved.error || resolved.data?.error}</div>
          ) : (
            <>
              <div className="note" style={{ marginBottom: 8 }}>
                Resolved package ID: <b>{resolved.data?.packageId ?? "none"}</b> ({resolved.data?.source})
              </div>
              <div className="wiz-body" style={{ marginBottom: 12 }}>
                {resolved.data?.candidateProjects?.map((project) => (
                  <div key={project.id} className="trow" onClick={() => setPinInput(String(project.id))}>
                    <div className="trow-main">
                      <div className="trow-title">{project.path_with_namespace}</div>
                      <div className="trow-meta">#{project.id}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row">
                <input className="input" style={{ flex: 1 }} placeholder="Pin a project ID..." value={pinInput} onChange={(event) => setPinInput(event.target.value)} />
                <Button
                  disabled={!pinInput}
                  onClick={async () => {
                    await toolStudioApi.pinNpmrcPackageId(group.id, group.full_path, pinInput);
                    void resolved.run(group.id, group.full_path);
                  }}
                >
                  Pin
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await toolStudioApi.unpinNpmrcPackageId(group.id, group.full_path);
                    setPinInput("");
                    void resolved.run(group.id, group.full_path);
                  }}
                >
                  Clear pin
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
