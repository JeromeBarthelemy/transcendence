import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // The manifest (name, icons, theme colour) is its own file (#155),
        // written and linked by hand: nothing here should generate or
        // inject a second one.
        manifest: false,
        // Replaces the cached shell as soon as a new version is found,
        // rather than asking the member to confirm it — there is no
        // "later" version of a page already open to protect them from.
        registerType: "autoUpdate",
        workbox: {
          // The shell only: an API response cached here would outlive the
          // write it answers, and a stale team home is worse than none
          // (#156's own words — offline data is #157's job, not this one).
          globPatterns: ["**/*.{js,css,html,png,svg,webp,woff2,webmanifest}"],
          navigateFallback: "/index.html",
          // Never the shell's fallback: each already answers on its own,
          // offline or not, and none is a client-side route.
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/ws\//,
            /^\/admin\//,
            /^\/static\//,
          ],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    server: {
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000",
          changeOrigin: true,
        },
        "/ws": {
          target: env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000",
          ws: true,
        },
      },
    },
  };
});
