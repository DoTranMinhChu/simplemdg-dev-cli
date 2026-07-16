import { useRef } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";

export function CpiQueuePage(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useAsync((file: File) => toolStudioApi.uploadCpiQueueZip(file));

  return (
    <div>
      <div className="ts-header">
        <h1>CPI Queue / Event Mesh</h1>
        <p className="note">
          Upload a zip of BTP Event Mesh service-key JSON files (downloaded from the BTP cockpit for each Event Mesh
          service instance) — every credential/endpoint comes from those files, nothing is hardcoded per customer.
          The predefined queue/subscription topology is applied per namespace.
        </p>
      </div>

      <div className="ts-card" style={{ maxWidth: 900 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload.run(file);
            event.target.value = "";
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={upload.loading}>
          {upload.loading ? <Spinner /> : "Upload service-key zip"}
        </Button>

        {upload.error && <div className="errbox" style={{ marginTop: 12 }}>{upload.error}</div>}
        {upload.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{upload.data.error}</div>}

        {upload.data?.results && (
          <div className="ts-result">
            {upload.data.results.map((file) => (
              <div key={file.serviceKeyFileName}>
                <div className={`ts-step-row ${file.ok ? "success" : "failed"}`}>
                  <span className="ts-step-icon">{file.ok ? "✓" : "✗"}</span>
                  <div>
                    <div>{file.serviceKeyFileName}{file.namespace ? ` — ${file.namespace}` : ""}</div>
                    {file.error && <div className="ts-step-detail">{file.error}</div>}
                  </div>
                </div>
                {file.queues?.map((queue) => (
                  <div className={`ts-step-row ${queue.ok ? "success" : "failed"}`} key={queue.queueName} style={{ marginLeft: 24, marginTop: 4 }}>
                    <span className="ts-step-icon">{queue.ok ? "✓" : "✗"}</span>
                    <div>
                      <div>{queue.queueName}</div>
                      {queue.error && <div className="ts-step-detail">{queue.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
