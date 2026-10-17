import type { RegisterCommand } from "../cli.js";
import { loadConfigOrFail, repoKeyOrFail, withStore } from "./shared.js";

export const showQuota: RegisterCommand = (program, io) => {
  program
    .command("show-quota")
    .description("Print the last quota event of each repo as JSON: every repo, or one with --repo")
    .option("-r, --repo <key>", "Print only the entry of the repo with this key")
    .action((options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const key = options.repo;
      if (key !== undefined) repoKeyOrFail(io, config, key);
      const records = withStore(config, (store) => store.listQuotaEvents(key));
      const list = records.map(({ repoKey, provider, receivedAt, event }) => ({
        repo: repoKey,
        provider,
        receivedAt,
        event,
      }));
      io.stdout(`${JSON.stringify(list, null, 2)}\n`);
    });
};
