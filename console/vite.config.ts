import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = {
  target: process.env.WARRANT_API ?? "http://127.0.0.1:8000",
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/api/, ""),
};

export default defineConfig({
  plugins: [react()],
  // The console talks to FastAPI through /api so the same code works in dev,
  // in preview, and behind a reverse proxy in deployment.
  server: { port: 5173, proxy: { "/api": API } },
  preview: { port: 4173, proxy: { "/api": API } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
} as never);
