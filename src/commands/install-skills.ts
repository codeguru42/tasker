import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CommanderError } from "commander";
import type { RegisterCommand } from "../cli.js";
import { compareText } from "../compare-text.js";
import { errorMessage } from "../error-message.js";
import { packagePath } from "../package-path.js";
import { loadConfigOrFail, orFail } from "./shared.js";

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
        let failed = false;
        // mkdirSync with recursive makes a missing skills folder and its missing parents.
        // rmSync with force gives no error for a missing <folder>/<name>. On a symlink, it removes only the link.
        // Symlinks are out of scope, so the command has no symlink check.
        for (const folder of config.skillsDirs) {
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
