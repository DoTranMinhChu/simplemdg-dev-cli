import React from "react";
import ReactDOM from "react-dom/client";
import { ProxyStudioApp } from "./features/proxy-studio/ProxyStudioApp";
import "./styles/theme.css";
import "./styles/globals.css";

(window as { __SMDG_STUDIO_EVENTS_PATH__?: string }).__SMDG_STUDIO_EVENTS_PATH__ = "/api/proxy/events";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ProxyStudioApp />
  </React.StrictMode>,
);
