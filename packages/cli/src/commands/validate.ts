import { Command } from "commander";

export const validateCommand = new Command("validate")
  .description("Check wikilinks, orphan files, and manifest correctness")
  .action(async () => {
    console.error("ebr validate is not yet implemented.");
    process.exit(1);
  });
