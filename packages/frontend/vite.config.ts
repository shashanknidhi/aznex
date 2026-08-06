import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The SPA is served under /dashboard; the landing page owns the root.
  base: "/dashboard/",
  plugins: [react()],
  server: {
    // Same-origin API in dev: the service runs on :3000.
    proxy: { "/api": "http://localhost:3000" },
  },
});
