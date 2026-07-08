import { useState } from "react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { studioApi, type TConnectionDraft } from "../../api/studio-api-client";
import type { TDatabaseType } from "../../api/studio-api-types";
import { useStudioStore } from "../../state/studio-store";

export function NewConnectionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (connectionId: string) => void }): React.ReactElement {
  const { toast, setActiveConnectionId } = useStudioStore();
  const [type, setType] = useState<TDatabaseType>("postgresql");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [schema, setSchema] = useState("public");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(true);
  const [message, setMessage] = useState("");

  const draft = (): TConnectionDraft => ({
    name: name.trim(),
    type,
    host: host.trim(),
    port: parseInt(port, 10) || (type === "hana" ? 443 : 5432),
    database: database.trim() || undefined,
    schema: schema.trim() || undefined,
    username: username.trim(),
    password,
    ssl,
  });

  const onTypeChange = (nextType: TDatabaseType): void => {
    setType(nextType);
    setPort(nextType === "hana" ? "443" : "5432");
    setSchema(nextType === "hana" ? "" : "public");
  };

  return (
    <Modal onClose={onClose} width={480}>
      <h3>New direct connection</h3>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>Type</label>
        <select className="select" value={type} onChange={(event) => onTypeChange(event.target.value as TDatabaseType)}>
          <option value="postgresql">PostgreSQL</option>
          <option value="hana">SAP HANA</option>
        </select>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Host</label>
          <input className="input" value={host} onChange={(event) => setHost(event.target.value)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Port</label>
          <input className="input" value={port} onChange={(event) => setPort(event.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Database</label>
          <input className="input" value={database} onChange={(event) => setDatabase(event.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Schema</label>
          <input className="input" value={schema} onChange={(event) => setSchema(event.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Username</label>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
      </div>
      <label className="note" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={ssl} onChange={(event) => setSsl(event.target.checked)} /> Use SSL
      </label>
      <div className="row right" style={{ marginTop: 10 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="sec"
          onClick={async () => {
            setMessage("Testing...");
            const result = await studioApi.testDraftConnection(draft());
            setMessage(result.success ? `OK ${result.serverVersion ?? ""}` : `Failed: ${result.message}`);
          }}
        >
          Test
        </Button>
        <Button
          onClick={async () => {
            const value = draft();
            if (!value.name || !value.host || !value.username) {
              setMessage("Name, host, username required.");
              return;
            }
            try {
              const response = await studioApi.createConnection(value);
              onClose();
              onCreated(response.connection.id);
              setActiveConnectionId(response.connection.id);
              toast("Connection saved.");
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Save &amp; use
        </Button>
      </div>
      {message ? <div className="note">{message}</div> : null}
    </Modal>
  );
}
