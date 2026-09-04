import { defineConfig } from "vite";
import { copyFile, mkdir } from "node:fs/promises";

function copyStaticAssets() {
  return {
    name: "copy-promoms-static-assets",
    async closeBundle() {
      await mkdir("dist/assets", { recursive: true });
      await copyFile("sw.js", "dist/sw.js");
      await copyFile("manifest.webmanifest", "dist/manifest.webmanifest");
      await copyFile("assets/promoms-logo.png", "dist/assets/promoms-logo.png");
    },
  };
}

export default defineConfig({
  plugins: [copyStaticAssets()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
