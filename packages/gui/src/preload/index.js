import { contextBridge } from "electron";

/**
 * Renderer-facing API surface, exposed on `window.ebr`.
 *
 * The bridge exposes a marker so the renderer can confirm it is running inside
 * the desktop shell rather than a plain browser.
 */
contextBridge.exposeInMainWorld("ebr", {
  isDesktop: true,
});
