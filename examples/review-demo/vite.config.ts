import { devtoolsChannel } from "@henrikkvamme/blueline/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/*
 * The review demo: a small Requests app with Blueline mounted as the manual says. The notes
 * go to `.blueline/` beside this file, through `blueline serve`, which the plugin starts.
 * The app mounts its own tools. The server listens on every interface, so a browser on
 * another Mac opens it at http://fry:4310.
 */

export default defineConfig({
  plugins: [react(), tailwindcss(), devtoolsChannel({ overlay: false })],
  server: { host: "0.0.0.0", port: 4310, strictPort: true, allowedHosts: ["fry"] },
});
