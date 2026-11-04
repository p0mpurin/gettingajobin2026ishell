import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

async function start() {
  // Outside Tauri (plain `npm run dev` in a browser) use sample data.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./dev/mock")).installMock();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
start();
