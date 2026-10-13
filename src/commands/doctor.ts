import { CommanderError } from "commander";
import type { RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { Check } from "../doctor/check.js";
import { dataRootCheck, freeSpaceCheck } from "../doctor/data-root.js";
import { errorMessage } from "../error-message.js";
import { runChecks } from "../doctor/run-checks.js";
import { issueProviderFor } from "../issues/provider.js";
import { createVcsProvider } from "../vcs/provider.js";
import { fail, loadConfigOrFail } from "./shared.js";

// The checks of tasker doctor, in order. It only builds the checks. A provider can throw here.
function doctorChecks(config: Config, env: NodeJS.ProcessEnv): Check[] {
  return [
    dataRootCheck(config.dataRoot),
    freeSpaceCheck(config.dataRoot, config.dataRootMinFreeBytes),
    ...Object.entries(config.repos).flatMap(([key, repo]) => [
      ...createVcsProvider(repo).doctorChecks(
        { dataRoot: config.dataRoot, repoKey: key, env },
        { procRoot: "/proc", platform: process.platform },
      ),
      ...issueProviderFor(config, key).doctorChecks([{ key, issueTracker: repo.issueTracker }]),
    ]),
  ];
}

export const doctor: RegisterCommand = (program, io) => {
  program
    .command("doctor")
    .description("Make sure that the configuration, the data root, git, gh and the accounts work")
    .action(async () => {
      const config = loadConfigOrFail(io);
      const env = process.env;
      let checks: Check[];
      try {
        checks = doctorChecks(config, env);
      } catch (error) {
        fail(io, errorMessage(error));
      }
      const code = await runChecks(checks, env, io.stdout);
      if (code !== 0) {
        throw new CommanderError(code, "tasker.doctor", "a required doctor check failed");
      }
    });
};
