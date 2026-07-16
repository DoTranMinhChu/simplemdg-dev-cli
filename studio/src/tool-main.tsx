import React from "react";
import ReactDOM from "react-dom/client";
import { ToolStudioApp } from "./features/tool-studio/ToolStudioApp";
import "./styles/theme.css";
import "./styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ToolStudioApp />
  </React.StrictMode>,
);
