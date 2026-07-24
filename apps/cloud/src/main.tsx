import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LandingApp } from "./landing/LandingApp.js";
import { parseLandingDisplayOptions } from "./landing/state.js";
import "./landing.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root application mount");

createRoot(root).render(
  <StrictMode>
    <LandingApp initialDisplay={parseLandingDisplayOptions(window.location.search)} />
  </StrictMode>,
);
