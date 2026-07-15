import { useEffect, useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { pluginsApi } from "../../../api/plugins-api-client";
import { useAiStudioStore } from "../../ai-studio/state/ai-studio-store";
import type { TInstallPlan, TInstallScope } from "../../../api/plugins-api-types";

/** Preview-then-execute, mirroring the export dialog's pattern: resolve the full dependency
 * closure and show exactly what will be written/registered before anything happens. */
export function InstallPlanDialog({
  ids,
  scope,
  projectRoot,
  onClose,
  onInstalled,
}: {
  ids: string[];
  scope: TInstallScope;
  projectRoot: string;
  onClose: () => void;
  onInstalled: () => void;
}): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [plan, setPlan] = useState<TInstallPlan | undefined>();
  const [planError, setPlanError] = useState<string | undefined>();
  const [installing, setInstalling] = useState(false);
  const [force, setForce] = useState(false);

  useEffect(() => {
    setPlan(undefined);
    setPlanError(undefined);
    pluginsApi
      .buildPlan(ids, scope, projectRoot || undefined)
      .then((response) => setPlan(response.plan))
      .catch((error) => setPlanError(error instanceof Error ? error.message : String(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, scope, projectRoot]);

  const pendingSteps = (plan?.steps ?? []).filter((step) => !step.alreadySatisfied);
  const driftedFiles = pendingSteps.flatMap((step) => step.filesToWrite.filter((file) => file.driftDetected));

  const onConfirm = async (): Promise<void> => {
    setInstalling(true);
    try {
      await pluginsApi.install(ids, scope, projectRoot || undefined, force);
      toast(`Installed ${pendingSteps.length} plugin(s).`);
      onInstalled();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal onClose={onClose} width={560}>
      <h3>Install plan</h3>

      {planError ? (
        <div className="note" style={{ color: "var(--red)" }}>
          {planError}
        </div>
      ) : !plan ? (
        <div className="note">
          <span className="spin" /> Resolving dependencies...
        </div>
      ) : (
        <>
          <div className="plugin-plan-list">
            {plan.steps.map((step) => (
              <div key={step.pluginId} className="plugin-plan-step">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{step.pluginId}</strong>
                  {step.alreadySatisfied ? <span className="note">already installed ({step.satisfiedAtScope})</span> : <span className="badge on">will install</span>}
                </div>
                {!step.alreadySatisfied ? (
                  <div className="note" style={{ marginTop: 4 }}>
                    {step.filesToWrite.map((file) => (
                      <div key={file.targetPath}>
                        file {file.targetPath}{" "}
                        {file.driftDetected ? <span style={{ color: "var(--red)" }}>(hand-modified, needs force)</span> : file.isNew ? "(new)" : "(overwrite)"}
                      </div>
                    ))}
                    {step.mcpServersToRegister.map((server) => (
                      <div key={server.name}>
                        mcp {server.name} (-s {server.scope})
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {driftedFiles.length > 0 ? (
            <label className="note" style={{ display: "block", marginTop: 10 }}>
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} /> Overwrite {driftedFiles.length} hand-modified file(s)
            </label>
          ) : null}
        </>
      )}

      <div className="row right" style={{ marginTop: 14, gap: 8 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!plan || installing || pendingSteps.length === 0 || (driftedFiles.length > 0 && !force)} onClick={onConfirm}>
          {installing ? "Installing…" : pendingSteps.length ? `Install ${pendingSteps.length} plugin(s)` : "Nothing to install"}
        </Button>
      </div>
    </Modal>
  );
}
