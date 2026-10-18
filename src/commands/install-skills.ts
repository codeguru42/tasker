import { cpSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CommanderError } from "commander";
import type { RegisterCommand } from "../cli.js";
import { compareText } from "../compare-text.js";
import { errorMessage } from "../error-message.js";
import { packagePath } from "../package-path.js";
import { loadConfigOrFail, orFail } from "./shared.js";

function isSourceFolder(folder: string, sourceReal: string): boolean {
  try {
    return realpathSync(folder) === sourceReal;
  } catch {
    return false;
  }
}

export function installSkillsFrom(sourceDir: string): RegisterCommand {
  return (program, io) => {
    program
      .command("install-skills")
      .description("Copy the skills of this tasker into each folder of skillsDirs")
      .action(() => {
        const config = loadConfigOrFail(io);
        const names = orFail(io, () =>
          readdirSync(sourceDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort(compareText),
        );
        const sourceReal = orFail(io, () => realpathSync(sourceDir));
        let failed = false;
        // mkdirSync with recursive makes a missing skills folder and its missing parents.
        // rmSync with force gives no error for a missing <folder>/<name>. On a symlink, it removes only the link.
        // Step 2 removes the source skill when the folder is the skills folder of tasker, so the command compares real paths first.
        // A folder with no real path, for example a missing folder or a path under a file, is not the source, because the source exists.
        for (const folder of config.skillsDirs) {
          if (isSourceFolder(folder, sourceReal)) {
            io.stderr(`error: cannot install to ${folder}: it is the skills folder of tasker\n`);
            failed = true;
            continue;
          }
          for (const name of names) {
            const target = join(folder, name);
            try {
              mkdirSync(folder, { recursive: true });
              rmSync(target, { recursive: true, force: true });
              cpSync(join(sourceDir, name), target, { recursive: true });
              io.stdout(`installed ${name} to ${target}\n`);
            } catch (error) {
              io.stderr(`error: cannot install ${name} to ${target}: ${errorMessage(error)}\n`);
              failed = true;
              break;
            }
          }
        }
        if (failed) {
          throw new CommanderError(1, "tasker.install-skills", "a skill did not install");
        }
      });
  };
}

export const installSkills: RegisterCommand = installSkillsFrom(packagePath("skills"));
