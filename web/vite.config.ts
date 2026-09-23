import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API runs on 8080 in development; VITE_API_BASE overrides it in prod.
    proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});
