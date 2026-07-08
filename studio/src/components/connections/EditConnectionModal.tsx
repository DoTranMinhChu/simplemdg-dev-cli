import { useState } from "react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { studioApi } from "../../api/studio-api-client";
import type { TPublicDatabaseConnection } from "../../api/studio-api-types";
import { useStudioStore } from "../../state/studio-store";

const SWATCHES = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#64748b"];
const ENVIRONMENTS = ["", "DEV", "QAS", "PROD", "SANDBOX", "CUSTOM"];

export function EditConnectionModal({
  connection,
  onClose,
  onSaved,
}: {
  connection: TPublicDatabaseConnection;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { toast } = useStudioStore();
  const [name, setName] = useState(connection.name);
  const [color, setColor] = useState(connection.color ?? "");
  const [environment, setEnvironment] = useState(connection.environment ?? "");

  return (
    <Modal onClose={onClose} width={420}>
      <h3>Edit connection</h3>
      <div className="field">
        <label>Display name</label>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="swatches">
          {SWATCHES.map((swatch) => (
            <div key={swatch} className={`swatch${color === swatch ? " sel" : ""}`} style={{ background: swatch }} onClick={() => setColor(swatch)} />
          ))}
        </div>
      </div>
      <div className="field">
        <label>Environment</label>
        <select className="select" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env || "(none)"}
            </option>
          ))}
        </select>
      </div>
      <div className="row right">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            try {
              await studioApi.updateConnection(connection.id, { name: name.trim() || connection.name, color, environment });
              onClose();
              onSaved();
              toast("Connection updated.");
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), "err");
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
