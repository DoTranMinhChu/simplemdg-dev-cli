/**
 * Open/save abstraction shared by the File Editor's spreadsheet and document editors.
 *
 * Opening a file (via the native picker or a drag-and-drop) can yield a writable
 * `FileSystemFileHandle` in Chromium browsers (Chrome/Edge) — when it does, `save()` writes
 * straight back to the same file on disk, no server round-trip involved. Everywhere else
 * (Firefox/Safari, or a plain `<input type="file">` fallback) there's no handle, so `save()`
 * falls back to a normal browser download instead.
 */

export type TFileEditorKind = "spreadsheet" | "document";

export type TOpenedFile = {
  name: string;
  bytes: ArrayBuffer;
  kind: TFileEditorKind;
  handle?: FileSystemFileHandle;
};

const MIME_BY_KIND: Record<TFileEditorKind, string> = {
  spreadsheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const PICKER_TYPES: FilePickerAcceptType[] = [
  { description: "Excel Workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } },
  { description: "Word Document", accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] } },
];

function kindFromName(name: string): TFileEditorKind | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) return "spreadsheet";
  if (lower.endsWith(".docx")) return "document";
  return undefined;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
}

async function buildOpenedFile(name: string, bytes: ArrayBuffer, handle?: FileSystemFileHandle): Promise<TOpenedFile> {
  const kind = kindFromName(name);
  if (!kind) throw new Error(`Unsupported file type: "${name}". Only .xlsx and .docx files are supported.`);
  return { name, bytes, kind, handle };
}

/** Native "Open" dialog (Chromium only). Returns `undefined` if the user cancels. */
export async function openViaPicker(): Promise<TOpenedFile | undefined> {
  if (!isFileSystemAccessSupported()) return undefined;
  let handles: FileSystemFileHandle[];
  try {
    handles = await window.showOpenFilePicker({ multiple: false, types: PICKER_TYPES });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
  const handle = handles[0];
  const file = await handle.getFile();
  return buildOpenedFile(file.name, await file.arrayBuffer(), handle);
}

/** One item from a `drop` event's `DataTransferItemList`. Prefers a writable handle when the browser offers one. */
export async function openViaDropItem(item: DataTransferItem): Promise<TOpenedFile | undefined> {
  if (typeof item.getAsFileSystemHandle === "function") {
    const handle = await item.getAsFileSystemHandle();
    if (handle && handle.kind === "file") {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      return buildOpenedFile(file.name, await file.arrayBuffer(), fileHandle);
    }
  }
  const file = item.getAsFile();
  if (!file) return undefined;
  return buildOpenedFile(file.name, await file.arrayBuffer());
}

/** Fallback for browsers without the File System Access API: a plain `<input type="file">`. */
export async function openViaInputFile(file: File): Promise<TOpenedFile> {
  return buildOpenedFile(file.name, await file.arrayBuffer());
}

/** Writes back to the original file when a handle is available, otherwise downloads a copy. */
export async function saveFile(file: TOpenedFile, bytes: BlobPart): Promise<{ savedInPlace: boolean }> {
  if (file.handle) {
    const writable = await file.handle.createWritable();
    await writable.write(bytes as FileSystemWriteChunkType);
    await writable.close();
    return { savedInPlace: true };
  }
  downloadBytes(file.name, bytes, MIME_BY_KIND[file.kind]);
  return { savedInPlace: false };
}

function downloadBytes(name: string, bytes: BlobPart, mimeType: string): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
