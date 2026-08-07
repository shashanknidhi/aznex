// @aznex/landing — the marketing page served at the site root.
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";
import App from "./App.js";

// ponytail: Vite tree-shakes the dev-only annotation toolbar out of prod builds.
createRoot(document.getElementById("root")!).render(
  <>
    <App />
    {import.meta.env.DEV && <Agentation />}
  </>,
);
