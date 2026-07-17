import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/globals.css";

// DB Studio's own server streams cache-refresh SSE at this path — see useStudioEvents.ts's doc
// (explicit here, even though it's also the hook's default, for parity with the other entries).
(window as { __SMDG_STUDIO_EVENTS_PATH__?: string }).__SMDG_STUDIO_EVENTS_PATH__ = "/api/events";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
