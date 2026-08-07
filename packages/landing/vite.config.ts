import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The landing page owns the site root; the app SPA sits under /dashboard.
  base: "/",
  plugins: [react()],
  // 5173 belongs to the app SPA, which runs alongside this in dev.
  server: { port: 5174 },
});
