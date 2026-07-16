import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
// Design tokens and the Tailwind layers come from the shared console package.
import "./shared-console/src/tokens.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
