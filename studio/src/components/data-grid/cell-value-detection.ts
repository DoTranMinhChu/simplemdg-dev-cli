export type TCellValueKind = "null" | "json" | "html" | "xml" | "date" | "datetime" | "number" | "boolean" | "url" | "email" | "base64" | "text";

export type TDetectedCellValue = {
  kind: TCellValueKind;
  confidence: number;
  rawValue: unknown;
  stringValue: string;
  formattedValue?: string;
  metadata: { length?: number; lineCount?: number; jsonValid?: boolean };
};

function cellString(value: unknown): string {
  return value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function isDateLike(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text) || /^\d{4}\/\d{2}\/\d{2}/.test(text);
}

export function prettyPrintMarkup(source: string): string {
  const spaced = source.replace(/>\s*</g, ">\n<");
  let indent = 0;
  const lines: string[] = [];
  for (let raw of spaced.split("\n")) {
    raw = raw.trim();
    if (!raw) continue;
    const isClosing = /^<\//.test(raw);
    if (isClosing && indent > 0) indent -= 1;
    lines.push("  ".repeat(indent) + raw);
    const isOpening = /^<[^!?/][^>]*[^/]>$/.test(raw) && !/<\//.test(raw);
    if (isOpening) indent += 1;
  }
  return lines.join("\n");
}

export function detectCellValue(value: unknown): TDetectedCellValue {
  const metadata: TDetectedCellValue["metadata"] = {};

  if (value === null || value === undefined) {
    return { kind: "null", confidence: 1, rawValue: value, stringValue: "", metadata };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", confidence: 1, rawValue: value, stringValue: String(value), metadata };
  }
  if (typeof value === "number") {
    return { kind: "number", confidence: 1, rawValue: value, stringValue: String(value), formattedValue: value.toLocaleString(), metadata };
  }

  const stringValue = cellString(value);
  const trimmed = stringValue.trim();
  metadata.length = stringValue.length;
  metadata.lineCount = stringValue.split("\n").length;

  if (trimmed && (trimmed[0] === "{" || trimmed[0] === "[")) {
    try {
      const parsed = JSON.parse(trimmed);
      metadata.jsonValid = true;
      return { kind: "json", confidence: 0.97, rawValue: value, stringValue, formattedValue: JSON.stringify(parsed, null, 2), metadata };
    } catch {
      metadata.jsonValid = false;
    }
  }

  if (/^<\?xml/i.test(trimmed)) {
    return { kind: "xml", confidence: 0.95, rawValue: value, stringValue, formattedValue: prettyPrintMarkup(stringValue), metadata };
  }

  if (/<(html|body|head|table|div|span|p|br|tr|td|ul|ol|li|a|h[1-6]|img|b|i|strong|em)[\s>/]/i.test(trimmed) || /&[a-z#0-9]+;/i.test(trimmed)) {
    return { kind: "html", confidence: 0.85, rawValue: value, stringValue, formattedValue: prettyPrintMarkup(stringValue), metadata };
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: "number", confidence: 0.8, rawValue: value, stringValue, formattedValue: Number(trimmed).toLocaleString(), metadata };
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return { kind: "boolean", confidence: 0.8, rawValue: value, stringValue, metadata };
  }
  if (isDateLike(trimmed)) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return { kind: /[ T]\d{2}:\d{2}/.test(trimmed) ? "datetime" : "date", confidence: 0.85, rawValue: value, stringValue, metadata };
    }
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return { kind: "url", confidence: 0.9, rawValue: value, stringValue, metadata };
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return { kind: "email", confidence: 0.9, rawValue: value, stringValue, metadata };
  }
  if (trimmed.length >= 16 && /^[A-Za-z0-9+/\r\n=]+$/.test(trimmed) && trimmed.replace(/[^A-Za-z0-9+/=]/g, "").length % 4 === 0) {
    return { kind: "base64", confidence: 0.5, rawValue: value, stringValue, metadata };
  }

  return { kind: "text", confidence: 0.6, rawValue: value, stringValue, metadata };
}

export function sqlLiteral(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${cellString(value).replace(/'/g, "''")}'`;
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*style[\s\S]*?<\s*\/\s*style\s*>/gi, "")
    .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "blocked:");
}
