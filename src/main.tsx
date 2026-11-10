import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// `?frame=macos|windows` draws a window frame around the app (screenshots).
const frame = new URLSearchParams(window.location.search).get("frame");
if (frame) document.documentElement.dataset.frame = frame;

// No "Reload / Inspect Element" menu inside the desktop app.
if (window.__TAURI_INTERNALS__) {
  window.addEventListener("contextmenu", (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
