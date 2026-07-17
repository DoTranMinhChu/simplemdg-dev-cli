import React from "react";
import ReactDOM from "react-dom/client";
import { ToolStudioApp } from "./features/tool-studio/ToolStudioApp";
import "./styles/theme.css";
import "./styles/globals.css";

// Tool Studio's own server streams cache-refresh SSE at this path (not DB Studio's `/api/events`,
// which doesn't exist here) — see useStudioEvents.ts's doc for why this needs to be per-entry.
(window as { __SMDG_STUDIO_EVENTS_PATH__?: string }).__SMDG_STUDIO_EVENTS_PATH__ = "/api/tool/events";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ToolStudioApp />
  </React.StrictMode>,
);
