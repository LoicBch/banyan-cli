import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapAuthFromUrl } from "./lib/auth";
import "./index.css";

// Run before the app mounts so the very first /api/state poll already
// carries the Bearer token in --remote mode. No-op when the URL hash
// has no `#token=…` (= localhost-only mode).
bootstrapAuthFromUrl();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
