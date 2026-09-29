import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// "single" mode inlines JS and CSS into index.html (used for the Claude artifact preview);
// the normal build is what Cloudflare Pages serves. Both read data/*.json at runtime.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "single" ? "dist-single" : "dist", copyPublicDir: mode !== "single" },
  server: { fs: { allow: [".."] } },
}));
