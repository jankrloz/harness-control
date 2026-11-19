import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4319,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4318",
        changeOrigin: true,
      },
    },
  },
});
