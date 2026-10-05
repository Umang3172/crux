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
  "/openapi.json",
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [path, { target: "http://localhost:8080", changeOrigin: true }]),
    ),
  },
  build: { outDir: "dist", sourcemap: true },
});
