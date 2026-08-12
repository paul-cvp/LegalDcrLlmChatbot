import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    base: "/dcr-js",
    resolve: {
      alias: {
        timers: "timers-browserify",
      },
    },
    server: {
      proxy: {
        "/api": {
          target: env.DCR_BACKEND_URL ?? "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
