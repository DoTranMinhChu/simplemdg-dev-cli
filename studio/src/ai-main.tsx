import React from "react";
import ReactDOM from "react-dom/client";
import { AiApp } from "./features/ai-studio/AiApp";
import "./styles/theme.css";
import "./styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AiApp />
  </React.StrictMode>,
);
