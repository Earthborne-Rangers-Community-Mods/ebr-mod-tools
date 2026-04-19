import { Command } from "commander";

export const updateCommand = new Command("update")
  .description("Check included mods for newer versions and merge updates")
  .action(async () => {
    // TODO: Call updateIncluded({ dir: process.cwd() }) with onUpdateAvailable callback for prompting
    console.error("ebr update is not yet implemented.");
    process.exit(1);
  });
