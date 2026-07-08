import { EmptyState } from "../common/EmptyState";
import type { TDatabaseQueryResult } from "../../api/studio-api-types";

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function SqlResultGrid({
  result,
  onCellActivate,
}: {
  result: TDatabaseQueryResult | undefined;
  onCellActivate?: (rowIndex: number, field: string, value: unknown, row: Record<string, unknown>) => void;
}): React.ReactElement {
  if (!result || !result.rows.length) {
    return <EmptyState>{result?.affectedRows != null ? `Affected rows: ${result.affectedRows}` : "No rows."}</EmptyState>;
  }

  const fields = result.fields.length ? result.fields : Object.keys(result.rows[0]);

  return (
    <table className="grid">
      <thead>
        <tr>
          <th className="rowhdr">#</th>
          {fields.map((field) => (
            <th key={field} title={field}>
              {field}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            <td className="rowhdr">{rowIndex + 1}</td>
            {fields.map((field) => {
              const value = row[field];
              const text = displayValue(value);
              return (
                <td
                  key={field}
                  className={typeof value === "number" ? "num" : ""}
                  title={text}
                  onDoubleClick={() => onCellActivate?.(rowIndex, field, value, row)}
                >
                  {text.length > 400 ? `${text.slice(0, 400)}…` : text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
