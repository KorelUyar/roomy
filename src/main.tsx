import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// `?frame=macos|windows` draws a window frame around the app (screenshots).
const frame = new URLSearchParams(window.location.search).get("frame");
if (frame) document.documentElement.dataset.frame = frame;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
