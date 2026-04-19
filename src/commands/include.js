import { Command } from "commander";

export const includeCommand = new Command("include")
  .description("Include base campaign updates or another mod into the current mod")
  .argument("<source>", "Source to include (e.g. 'base' or a repo URL/mod ID)")
  .action(async (source) => {
    // TODO: Call includeSource({ dir: process.cwd(), source }) and format output
    console.error(`ebr include is not yet implemented. (source: ${source})`);
    process.exit(1);
  });
