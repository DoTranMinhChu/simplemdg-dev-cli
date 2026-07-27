/**
 * Converts between real .xlsx bytes (via exceljs) and Fortune-sheet's in-memory `Sheet[]` model.
 *
 * Scope is deliberately basic, matching what the File Editor promises: cell values, `=SUM(...)`-style
 * formulas (stored as strings, evaluated by Fortune-sheet's own formula engine once loaded), multiple
 * sheets, and simple per-cell formatting (bold/italic/font size/font color/fill color). Merged cells,
 * column widths, number formats, and rich per-run text styling are not round-tripped.
 */
import * as ExcelJS from "exceljs";
import type { Cell as FortuneCell, CellWithRowAndCol, Sheet } from "@fortune-sheet/core";

const MIN_ROWS = 60;
const MIN_COLUMNS = 26;

function argbToHex(argb: string | undefined): string | undefined {
  if (!argb) return undefined;
  const rgb = argb.length === 8 ? argb.slice(2) : argb;
  return `#${rgb}`;
}

function hexToArgb(hex: string): string {
  const clean = hex.replace("#", "");
  return `FF${clean.toUpperCase()}`;
}

function excelCellToFortuneCell(cell: ExcelJS.Cell): FortuneCell | null {
  if (cell.type === ExcelJS.ValueType.Null || cell.type === ExcelJS.ValueType.Merge) return null;

  const result: FortuneCell = {};

  if (cell.type === ExcelJS.ValueType.Formula) {
    const formulaValue = cell.value as ExcelJS.CellFormulaValue;
    result.f = `=${formulaValue.formula}`;
    const computed = formulaValue.result;
    const isErrorResult = !!computed && typeof computed === "object" && "error" in computed;
    result.v = isErrorResult ? (computed as ExcelJS.CellErrorValue).error : ((computed as string | number | boolean | undefined) ?? "");
    result.m = String(result.v ?? "");
  } else if (cell.type === ExcelJS.ValueType.RichText) {
    const text = (cell.value as ExcelJS.CellRichTextValue).richText.map((run) => run.text).join("");
    result.v = text;
    result.m = text;
  } else if (cell.type === ExcelJS.ValueType.Hyperlink) {
    const text = (cell.value as ExcelJS.CellHyperlinkValue).text;
    result.v = text;
    result.m = text;
  } else if (cell.type === ExcelJS.ValueType.Date) {
    const date = cell.value as Date;
    result.v = date.toISOString();
    result.m = date.toLocaleString();
  } else if (cell.type === ExcelJS.ValueType.Error) {
    const errorText = (cell.value as ExcelJS.CellErrorValue).error;
    result.v = errorText;
    result.m = errorText;
  } else {
    const value = cell.value;
    if (value === null || value === undefined) return null;
    result.v = value as string | number | boolean;
    result.m = String(value);
  }

  const font = cell.font;
  if (font?.bold) result.bl = 1;
  if (font?.italic) result.it = 1;
  if (font?.size) result.fs = font.size;
  if (font?.name) result.ff = font.name;
  const fontColor = argbToHex(font?.color?.argb);
  if (fontColor) result.fc = fontColor;

  const fill = cell.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const fillColor = argbToHex(fill.fgColor?.argb);
    if (fillColor) result.bg = fillColor;
  }

  return result;
}

export async function workbookBytesToSheets(bytes: ArrayBuffer): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  return workbook.worksheets.map((worksheet, index) => {
    const celldata: CellWithRowAndCol[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const value = excelCellToFortuneCell(cell);
        if (value) celldata.push({ r: rowNumber - 1, c: colNumber - 1, v: value });
      });
    });

    const sheet: Sheet = {
      id: `sheet-${index}`,
      name: worksheet.name,
      order: index,
      status: index === 0 ? 1 : 0,
      celldata,
      row: Math.max(worksheet.rowCount + 20, MIN_ROWS),
      column: Math.max(worksheet.columnCount + 10, MIN_COLUMNS),
    };
    return sheet;
  });
}

export async function sheetsToWorkbookBytes(sheets: Sheet[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name || "Sheet");
    for (const entry of sheet.celldata ?? []) {
      const cellData = entry.v;
      if (!cellData) continue;

      const cell = worksheet.getCell(entry.r + 1, entry.c + 1);
      if (cellData.f) {
        const formula = cellData.f.startsWith("=") ? cellData.f.slice(1) : cellData.f;
        const result = typeof cellData.v === "string" || typeof cellData.v === "number" || typeof cellData.v === "boolean" ? cellData.v : undefined;
        cell.value = { formula, result } as ExcelJS.CellFormulaValue;
      } else if (cellData.v !== undefined && cellData.v !== null) {
        cell.value = cellData.v;
      }

      if (cellData.bl || cellData.it || cellData.fs || cellData.fc || typeof cellData.ff === "string") {
        cell.font = {
          bold: cellData.bl === 1,
          italic: cellData.it === 1,
          size: cellData.fs,
          name: typeof cellData.ff === "string" ? cellData.ff : undefined,
          color: cellData.fc ? { argb: hexToArgb(cellData.fc) } : undefined,
        };
      }
      if (cellData.bg) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(cellData.bg) } };
      }
    }
  }

  return workbook.xlsx.writeBuffer();
}
