import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { existsSync } from "node:fs";
import type { Plugin } from "vite";
import { SOUND_FILES } from "./src/sound.ts";
const host = process.env.TAURI_DEV_HOST;

// 知らせる音のファイル（public/sounds/）が揃っていなければビルドを止める。
// 素材は再配布できないので git に入っておらず、置き忘れると音の無い版を配ってしまう（docs/release.md）
function requireSounds(): Plugin {
  return {
    name: "require-sounds",
    apply: "build",
    buildStart() {
      const missing = SOUND_FILES.filter((f) => !existsSync(`public/${f}`));
      if (missing.length > 0) {
        this.error(`知らせる音のファイルがありません（docs/release.md の「音のファイル」）：\n  public/${missing.join("\n  public/")}`);
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), requireSounds()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // テストは日本語の表記で書いているので、言語を日本語にしてから走らせる
  test: {
    setupFiles: ["src/test-setup.ts"],
    // server/ の Worker のテストは server/ 側の vitest（vitest-pool-workers）で走らせる
    exclude: ["**/node_modules/**", "server/**"],
  },
}));
