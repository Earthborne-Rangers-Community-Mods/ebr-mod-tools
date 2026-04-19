#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { setupCommand } from "./commands/setup.js";
import { newCommand } from "./commands/new.js";
import { validateCommand } from "./commands/validate.js";
import { includeCommand } from "./commands/include.js";
import { updateCommand } from "./commands/update.js";
import { saveCommand } from "./commands/save.js";
import { publishCommand } from "./commands/publish.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program
  .name("ebr")
  .description("CLI tools for Earthborne Rangers mod creators")
  .version(pkg.version);

program.addCommand(setupCommand);
program.addCommand(newCommand);
program.addCommand(validateCommand);
program.addCommand(includeCommand);
program.addCommand(updateCommand);
program.addCommand(saveCommand);
program.addCommand(publishCommand);

program.parse();
