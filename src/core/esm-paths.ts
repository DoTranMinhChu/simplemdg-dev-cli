import path from "node:path";
import { fileURLToPath } from "node:url";

/** Equivalent of CJS `__dirname` for an ESM module: `getDirname(import.meta.url)`. */
export function getDirname(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}
