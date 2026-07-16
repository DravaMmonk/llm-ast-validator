import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  // Blockly otherwise defaults to blockly-demo.appspot.com for its UI media.
  // Serve the package-owned assets locally in dev and copy them into builds.
  publicDir: "node_modules/blockly/media",
  server: {
    // The browser never talks to SQLite; business state lives behind the local API.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
});
