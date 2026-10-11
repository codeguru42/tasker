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

export function commandsMissingFromSkill(helpText: string, skillText: string): string[] {
  const headings = new Set(skillText.split("\n").map((line) => line.trim()));
  return commandsInHelp(helpText).filter((name) => !headings.has(`### \`tasker ${name}\``));
}
