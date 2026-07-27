import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { WorkbookInstance } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
import { Spinner } from "../../../components/common/Spinner";
import { sheetsToWorkbookBytes, workbookBytesToSheets } from "../../../lib/xlsx-fortune-bridge";

export type TSpreadsheetEditorHandle = {
  exportBytes: () => Promise<ArrayBuffer>;
};

type TSpreadsheetEditorProps = {
  bytes: ArrayBuffer;
  onDirtyChange?: (dirty: boolean) => void;
};

export const SpreadsheetEditor = forwardRef<TSpreadsheetEditorHandle, TSpreadsheetEditorProps>(function SpreadsheetEditor(
  { bytes, onDirtyChange },
  ref,
) {
  const [sheets, setSheets] = useState<Sheet[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const workbookRef = useRef<WorkbookInstance>(null);
  const latestSheetsRef = useRef<Sheet[] | undefined>(undefined);
  // Fortune-sheet fires onChange several times while settling a freshly loaded workbook (data load,
  // forceCalculation's recompute, layout, ...), not just for user edits — swallow onChange for a
  // short window after each load so the dirty indicator doesn't light up before the user has
  // touched anything. A plain "ignore the first call" isn't enough since more than one fires.
  const suppressChangesUntilRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setSheets(undefined);
    setError(undefined);
    workbookBytesToSheets(bytes)
      .then((result) => {
        if (cancelled) return;
        latestSheetsRef.current = result;
        suppressChangesUntilRef.current = Date.now() + 800;
        setSheets(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  useImperativeHandle(
    ref,
    () => ({
      exportBytes: async () => {
        const workbook = workbookRef.current;
        const latest = workbook?.getAllSheets() ?? latestSheetsRef.current ?? [];
        // getAllSheets() returns each sheet's live state as the dense `data` matrix, not the sparse
        // `celldata` array `sheetsToWorkbookBytes` reads — `celldata` here only reflects whatever was
        // passed in on initial load. Rebuild it from `data` so edits are actually captured on save.
        const normalized = latest.map((sheet) => {
          if (!workbook || !sheet.data) return sheet;
          return { ...sheet, celldata: workbook.dataToCelldata(sheet.data) };
        });
        return sheetsToWorkbookBytes(normalized);
      },
    }),
    [],
  );

  if (error) {
    return <div className="errbox">Could not open this workbook: {error}</div>;
  }

  if (!sheets) {
    return (
      <div className="note faint" style={{ padding: 16 }}>
        <Spinner /> Parsing workbook...
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 260px)", minHeight: 480 }}>
      <Workbook
        ref={workbookRef}
        data={sheets}
        onChange={() => {
          latestSheetsRef.current = workbookRef.current?.getAllSheets();
          if (Date.now() < suppressChangesUntilRef.current) return;
          onDirtyChange?.(true);
        }}
        showToolbar
        showFormulaBar
        showSheetTabs
        allowEdit
        forceCalculation
      />
    </div>
  );
});
