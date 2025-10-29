import React from "react";
import ReactDOM from "react-dom/client";
import { DebugPage } from "../src/components/DebugPage";
import "../src/debug.css";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <DebugPage />
    </React.StrictMode>
  );
}
