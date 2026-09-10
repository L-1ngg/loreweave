import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 41735,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:41736" },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
