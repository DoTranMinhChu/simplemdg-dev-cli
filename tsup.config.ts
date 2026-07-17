import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  shims: false,
  splitting: false,
  external: ["pg", "@sap/hana-client", "playwright", "@sap/cds-lsp"],
});
