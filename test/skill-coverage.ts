export function commandsInHelp(helpText: string): string[] {
  const lines = helpText.split("\n");
  const start = lines.indexOf("Commands:");
  if (start === -1) {
    return [];
  }
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      break;
    }
    const name = /^ {2}([^\s|]+)/.exec(line)?.[1];
    if (name !== undefined && name !== "help") {
      names.push(name);
    }
  }
  return names;
}

function entryOf(skillText: string, name: string): string | undefined {
  const lines = skillText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `### \`tasker ${name}\``);
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function commandsWithoutReference(
  helpText: string,
  skillText: string,
  readReference: (file: string) => string | undefined,
): string[] {
  return commandsInHelp(helpText).filter((name) => {
    const entry = entryOf(skillText, name);
    const file =
      entry === undefined
        ? undefined
        : new RegExp(`\\]\\((references/[a-z-]+\\.md)#tasker-${name}\\)`).exec(entry)?.[1];
    if (file === undefined) {
      return true;
    }
    const reference = readReference(file);
    if (reference === undefined) {
      return true;
    }
    return !reference.split("\n").some((line) => line.trim() === `## \`tasker ${name}\``);
  });
}

export function commandsMissingFromSkill(helpText: string, skillText: string): string[] {
  const headings = new Set(skillText.split("\n").map((line) => line.trim()));
  return commandsInHelp(helpText).filter((name) => !headings.has(`### \`tasker ${name}\``));
}
