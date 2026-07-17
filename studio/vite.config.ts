import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend (src/core/db/db-studio-server.ts) resolves the built UI at
// <packageRoot>/dist/core/db/studio-dist, anchored to the CLI package root so
// it works identically compiled or under `tsx`. Build straight there so no
// copy step is needed.
const STUDIO_DIST = path.resolve(__dirname, "../dist/core/db/studio-dist");
const BACKEND_PORT = process.env.SMDG_STUDIO_API_PORT ?? "45888";

// AI Studio (smdg ai studio) and Tool Studio (smdg tool studio) are additional Vite entries built
// into the same output directory as DB Studio — each backend server just requests its own HTML
// file as SPA-fallback root instead of index.html. Vite hashes each entry's asset filenames
// independently, so sharing one outDir/assets folder is safe and avoids extra dist locations.
const AI_STUDIO_BACKEND_PORT = process.env.SMDG_AI_STUDIO_API_PORT ?? "45889";
const TOOL_STUDIO_BACKEND_PORT = process.env.SMDG_TOOL_STUDIO_API_PORT ?? "45890";
const PROXY_STUDIO_BACKEND_PORT = process.env.SMDG_PROXY_STUDIO_API_PORT ?? "45891";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: STUDIO_DIST,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        aiStudio: path.resolve(__dirname, "ai-studio.html"),
        toolStudio: path.resolve(__dirname, "tool-studio.html"),
        proxyStudio: path.resolve(__dirname, "proxy-studio.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api/ai": {
        target: `http://127.0.0.1:${AI_STUDIO_BACKEND_PORT}`,
        changeOrigin: false,
      },
      "/api/tool": {
        target: `http://127.0.0.1:${TOOL_STUDIO_BACKEND_PORT}`,
        changeOrigin: false,
        // SSE (/api/tool/events) needs the connection kept open, not buffered.
        ws: false,
      },
      "/api/proxy": {
        target: `http://127.0.0.1:${PROXY_STUDIO_BACKEND_PORT}`,
        changeOrigin: false,
        // SSE (/api/proxy/events) needs the connection kept open, not buffered.
        ws: false,
      },
      "/api": {
        target: `http://127.0.0.1:${BACKEND_PORT}`,
        changeOrigin: false,
        // SSE (/api/events) needs the connection kept open, not buffered.
        ws: false,
      },
    },
  },
});
