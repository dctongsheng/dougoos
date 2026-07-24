import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createBrowserCoreDataSource } from "./core/browser-connection.js";
import { App } from "./saas/App.js";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root application mount");
const dataSource = createBrowserCoreDataSource();

createRoot(root).render(
  <StrictMode>
    <App {...(dataSource === undefined ? {} : { dataSource })} />
  </StrictMode>,
);
