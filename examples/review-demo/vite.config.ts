import { devtoolsChannel } from "@henrikkvamme/blueline/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { agent } from "./agent";
import { guard } from "./guard";
import { realtime } from "./realtime";
import { takes } from "./takes";
import { voice } from "./voice";

/*
 * The review demo: a small Requests app with Blueline mounted as the manual says. The notes
 * go to `.blueline/` beside this file, through `blueline serve`, which the plugin starts.
 * The app mounts its own tools. The server listens on every interface, so a browser on
 * another Mac opens it at http://fry:4310.
 */

export default defineConfig({
  plugins: [
    // First, so it stands before every route of the demo.
    guard(),
    react(),
    tailwindcss(),
    devtoolsChannel({ overlay: false }),
    voice(),
    realtime(),
    agent(),
    takes(),
  ],
  server: { host: "0.0.0.0", port: 4310, strictPort: true, allowedHosts: ["fry"] },
});
