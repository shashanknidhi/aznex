// @aznex/frontend — read-only memory viewer SPA
// Browse, search, and inspect team memory for a repo.
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
