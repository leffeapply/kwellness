import { defineConfig } from "vite";
import { sites } from "@openai/sites-vite-plugin";
import { copyFile, mkdir } from "node:fs/promises";

function packageStaticSite() {
  return {
    name: "package-k-wellness-static-site",
    async closeBundle() {
      await mkdir("dist/server", { recursive: true });
      await mkdir("dist/client/assets", { recursive: true });
      await copyFile("worker.js", "dist/server/index.js");
      await copyFile("sw.js", "dist/client/sw.js");
      await copyFile("manifest.webmanifest", "dist/client/manifest.webmanifest");
      await copyFile("assets/icon.svg", "dist/client/assets/icon.svg");
    },
  };
}

export default defineConfig({
  plugins: [sites(), packageStaticSite()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
