import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/**
 * Injects the Content-Security-Policy meta into the renderer HTML, tightening
 * it for the packaged build: the dev server's HMR needs a websocket
 * (`connect-src ... ws: wss:`), but the shipped app has no dev server and need
 * not allow arbitrary websocket connections, so `connect-src` is `'self'` only
 * in production.
 */
function rendererCsp() {
  return {
    name: "ebr-renderer-csp",
    transformIndexHtml(html, ctx) {
      const isDev = Boolean(ctx.server);
      const connectSrc = isDev ? "'self' ws: wss:" : "'self'";
      const content =
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          `connect-src ${connectSrc}`,
        ].join("; ") + ";";
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content,
            },
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}

/**
 * electron-vite build configuration.
 *
 * Main and preload run in Node/Electron and externalize their runtime
 * dependencies (shipped as node_modules in the packaged app). The renderer is a
 * plain Svelte SPA.
 *
 * Dependency propagation: the GUI declares a runtime dependency on the private
 * `core` workspace package (package.json), so electron-builder collects core and
 * its transitive deps (simple-git, @octokit/rest) into the packaged app.
 * externalizeDepsPlugin() keeps those runtime deps (including core) out of the
 * bundle; they are resolved from node_modules in the packaged app.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [svelte(), rendererCsp()],
  },
});
