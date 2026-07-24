#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { setupCommand } from "./commands/setup.js";
import { newCommand } from "./commands/new.js";
import { validateCommand } from "./commands/validate.js";
import { includeCommand } from "./commands/include.js";
import { scaffoldCommand } from "./commands/scaffold.js";
import { updateCommand } from "./commands/update.js";
import { saveCommand } from "./commands/save.js";
import { publishCommand } from "./commands/publish.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Version is injected at build time by scripts/build.mjs. Running the unbundled
// source in development falls back to reading the package manifest.
const version =
  process.env.EBR_CLI_VERSION ??
  JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")).version;

const program = new Command();

program
  .name("ebr")
  .description("CLI tools for Earthborne Rangers mod creators")
  .version(version);

program.addCommand(setupCommand);
program.addCommand(newCommand);
program.addCommand(validateCommand);
program.addCommand(includeCommand);
program.addCommand(scaffoldCommand);
program.addCommand(updateCommand);
program.addCommand(saveCommand);
program.addCommand(publishCommand);

program.parse();
