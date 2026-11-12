import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid backend PORT");
  }
  const target = `http://127.0.0.1:${port}`;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      proxy: {
        "/api": {
          target,
          rewrite: (url) => url.replace(/^\/api/, ""),
          headers: env.PUBLISH_API_KEY
            ? { Authorization: `Bearer ${env.PUBLISH_API_KEY}` }
            : {},
        },
        "/media": { target },
      },
    },
    preview: { host: "127.0.0.1" },
  };
});
