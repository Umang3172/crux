import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In production the container serves this bundle and the API from one origin,
// so the client uses relative paths. The dev server proxies the same paths, so
// `VITE_API_BASE=""` behaves exactly like the deployed build while you work.
const API_PATHS = [
  "/health",
  "/tests",
  "/investigations",
  "/replay",
  "/spectrum",
  "/capture",
  "/maintenance",
  "/fleet",
  "/lens",
  "/agent",
  "/machine",
  "/ingest",
  "/openapi.json",
];

export default defineConfig({
  plugins: [react()],
  // Several dev servers can run side by side when each is given its own cache folder.
  cacheDir: process.env.CRUX_VITE_CACHE || "node_modules/.vite",
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [path, { target: "http://localhost:8080", changeOrigin: true }]),
    ),
  },
  build: { outDir: "dist", sourcemap: true },
});
