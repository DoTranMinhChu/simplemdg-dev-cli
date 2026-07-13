import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { setSkipLaunchConfirm } from "../launch-confirm";
import type { TAiSessionLaunchCommand } from "../../../api/ai-studio-api-types";

/** Shown before launching a new terminal, so the developer sees exactly what will run before it runs. */
export function LaunchConfirmModal({
  title,
  launch,
  onConfirm,
  onCancel,
}: {
  title: string;
  launch: TAiSessionLaunchCommand;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [skipNextTime, setSkipNextTime] = useState(false);

  return (
    <Modal onClose={onCancel} width={560}>
      <h3>{title}</h3>
      <p className="note">This opens a new terminal window and runs:</p>
      <pre className="cell-pre wrap" style={{ marginBottom: 10 }}>
        {launch.command}
      </pre>
      <p className="note">Working directory: {launch.workingDirectory}</p>
      <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
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
            onConfirm();
          }}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
