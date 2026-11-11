import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// `?frame=macos|windows` draws a window frame around the app (screenshots).
const frame = new URLSearchParams(window.location.search).get("frame");
if (frame) document.documentElement.dataset.frame = frame;

// Motion starts once the window has been seen. A page nobody is looking at
// does not advance its animations, and several of them begin invisible: so
// until then (and in a screenshot taken without a screen) everything simply
// stands in its final state.
const seen = () => {
  if (document.visibilityState !== "visible") return;
  document.documentElement.dataset.live = "";
  document.removeEventListener("visibilitychange", seen);
};
document.addEventListener("visibilitychange", seen);
seen();

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
