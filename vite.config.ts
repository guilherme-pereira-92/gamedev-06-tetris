import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/gamedev-06-tetris/" : "/",
  server: { port: 5178, open: true },
  build: { target: "es2020" },
}));
