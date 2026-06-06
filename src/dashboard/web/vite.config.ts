/**
 * Vite config for the React dashboard.
 *
 * Outputs to `dist/src/dashboard/web/` so Express can serve it as static
 * files from inside the published banyan package.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../../../dist/src/dashboard/web"),
    emptyOutDir: true,
    // No need for a manifest — Express serves the index.html directly.
  },
  server: {
    port: 5173,
    // Proxy /api/* to a running `bn serve` so we can develop the UI
    // against real backend state.
    proxy: {
      "/api": "http://localhost:4242",
    },
  },
});
