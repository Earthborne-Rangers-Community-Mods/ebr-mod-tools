import { createRequire } from "node:module";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import renderer from "vite-plugin-electron-renderer";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

/**
 * The renderer keeps `core`'s runtime dependencies external (loaded via
 * `require()`). Every core dep is marked `type: "cjs"` (external + `require()`),
 * which covers CJS packages and ESM packages Node can `require(esm)`.
 */
const coreManifest = createRequire(import.meta.url)("../core/package.json");
const rendererResolve = Object.fromEntries(
  Object.keys(coreManifest.dependencies ?? {}).map((name) => [name, { type: "cjs" }]),
);

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
      // The renderer reaches the GitHub REST API directly (Octokit) to resolve
      // the signed-in login and create forks, so api.github.com must be an
      // allowed connect target.
      const githubApi = "https://api.github.com";
      // The renderer also fetches the public registry (registry.json) anonymously
      // over raw.githubusercontent
      const registryHost = "https://raw.githubusercontent.com";
      // The emoji picker loads its emoji database from a same-origin blob: URL
      // (the data ships bundled and is handed to the picker via URL.createObjectURL,
      // so nothing is fetched from the network). blob: URLs can only be minted by
      // same-origin first-party script, so allowing them as a connect target does
      // not widen the network surface.
      const blobSrc = "blob:";
      const connectSrc = isDev
        ? `'self' ${blobSrc} ${githubApi} ${registryHost} ws: wss:`
        : `'self' ${blobSrc} ${githubApi} ${registryHost}`;
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
 * The main process runs in Node/Electron and externalizes its runtime
 * dependencies (shipped as node_modules in the packaged app). The renderer is a
 * plain Svelte SPA that runs with nodeIntegration on and contextIsolation off,
 * so it imports the workspace `core` package directly and calls core functions
 * inline - there is no preload bridge.
 *
 * Dependency propagation: the GUI declares a runtime dependency on the private
 * `core` workspace package (package.json). electron-vite inlines core's source
 * into the renderer bundle, while core's third-party runtime deps stay external
 * and are collected into the packaged app by electron-builder.
 *
 * vite-plugin-electron-renderer makes those external imports resolvable in the
 * nodeIntegration renderer: it rewrites them to CommonJS `require()` (Chromium
 * cannot resolve bare specifiers from ES modules). It auto-handles Node built-ins
 * and electron; third-party packages are listed in `resolve`.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [
      renderer({
        resolve: rendererResolve,
      }),
      svelte(),
      rendererCsp(),
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/renderer/src/lib/paraglide",
        strategy: ["baseLocale"],
      }),
    ],
  },
});
