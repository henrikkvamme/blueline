import path from "node:path";
import { devtoolsChannel } from "@henrikkvamme/blueline/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/*
 * The review demo: a small Requests app with Blueline mounted as the manual says. The notes
 * go to `.blueline/` beside this file. The server listens on every interface, so a browser
 * on another Mac opens it at http://fry:4310.
 */
const blueline = path.join(import.meta.dirname, ".blueline");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devtoolsChannel({
      feedback: path.join(blueline, "feedback.jsonl"),
      status: path.join(blueline, "status.json"),
    }),
  ],
  server: { host: "0.0.0.0", port: 4310, strictPort: true, allowedHosts: ["fry"] },
});
