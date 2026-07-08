import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend (src/core/db/db-studio-server.ts) resolves the built UI at
// <packageRoot>/dist/core/db/studio-dist, anchored to the CLI package root so
// it works identically compiled or under `tsx`. Build straight there so no
// copy step is needed.
const STUDIO_DIST = path.resolve(__dirname, "../dist/core/db/studio-dist");
const BACKEND_PORT = process.env.SMDG_STUDIO_API_PORT ?? "45888";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: STUDIO_DIST,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${BACKEND_PORT}`,
        changeOrigin: false,
        // SSE (/api/events) needs the connection kept open, not buffered.
        ws: false,
      },
    },
  },
});
