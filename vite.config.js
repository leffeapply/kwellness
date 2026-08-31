import { defineConfig } from "vite";
import { copyFile, mkdir } from "node:fs/promises";

function copyStaticAssets() {
  return {
    name: "copy-k-wellness-static-assets",
    async closeBundle() {
      await mkdir("dist/assets", { recursive: true });
      await copyFile("sw.js", "dist/sw.js");
      await copyFile("manifest.webmanifest", "dist/manifest.webmanifest");
      await copyFile("assets/icon.svg", "dist/assets/icon.svg");
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
