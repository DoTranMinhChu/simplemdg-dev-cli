import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useAsync } from "../../../hooks/useAsync";
import type { TConnectivityTestResult } from "../api/tool-studio-api-client";

export type TConnectivityTestField = {
  name: string;
  label: string;
  type?: "text" | "password" | "number";
  placeholder?: string;
  defaultValue?: string;
  half?: boolean;
};

export type TConnectivityTestFormProps = {
  fields: TConnectivityTestField[];
  runLabel?: string;
  onRun: (values: Record<string, string>) => Promise<TConnectivityTestResult>;
};

const STEP_ICON: Record<TConnectivityTestResult["steps"][number]["status"], string> = {
  success: "✓",
  failed: "✗",
  skipped: "–",
};

/** Renders a form for one connectivity test (SharePoint, Azure Blob, S3, ...) and its step-by-step result. */
export function ConnectivityTestForm({ fields, runLabel = "Run test", onRun }: TConnectivityTestFormProps): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) initial[field.name] = field.defaultValue ?? "";
    return initial;
  });

  const test = useAsync(() => onRun(values));

  return (
    <div className="ts-card">
      <div className="ts-grid-2">
        {fields.map((field) => (
          <div className="field" key={field.name} style={field.half ? undefined : { gridColumn: "1 / -1" }}>
            <label htmlFor={`ts-field-${field.name}`}>{field.label}</label>
            <input
              id={`ts-field-${field.name}`}
              className="input"
              type={field.type ?? "text"}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="row">
        <Button onClick={() => void test.run()} disabled={test.loading}>
          {test.loading ? <Spinner /> : runLabel}
        </Button>
      </div>

      {test.error && (
        <div className="errbox" style={{ marginTop: 12 }}>
          {test.error}
        </div>
      )}

      {test.data && (
        <div className="ts-result">
          {test.data.steps.map((step) => (
            <div className={`ts-step-row ${step.status}`} key={step.key}>
              <span className="ts-step-icon">{STEP_ICON[step.status]}</span>
              <div>
                <div>{step.label}</div>
                {step.detail && <div className="ts-step-detail">{step.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
