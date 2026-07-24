import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { VisualApp } from "./visual/VisualApp.js";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root application mount");

createRoot(root).render(
  <StrictMode>
    <VisualApp />
  </StrictMode>,
);
