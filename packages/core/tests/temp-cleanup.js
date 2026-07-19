import { afterAll } from "vitest";
import { cleanupTempRoot } from "./helpers.js";

afterAll(async () => {
  await cleanupTempRoot();
});
