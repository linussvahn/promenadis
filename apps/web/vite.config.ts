import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Start must come before the React plugin.
    tanstackStart({ srcDirectory: "app", server: { entry: "server.ts" } }),
    viteReact(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:54321",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/u, "/functions/v1/api-v1/browser"),
      },
    },
  },
});
