/** Helpers for the text of a doc, used by the tests of the planner prompt templates. */

/**
 * Give the lines after the line `## <heading>`, up to the next line that starts with `#`
 * or up to the end of the text. Blank lines at the start and at the end are removed.
 * Give `undefined` if the heading is missing.
 */
export function markdownSection(text: string, heading: string): string | undefined {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  const section = end === -1 ? rest : rest.slice(0, end);
  let first = 0;
  let last = section.length;
  while (first < last && section[first]?.trim() === "") first += 1;
  while (last > first && section[last - 1]?.trim() === "") last -= 1;
  return section.slice(first, last).join("\n");
}

/** Give each doc path in the text, in order, with no duplicates. */
export function docPaths(text: string): string[] {
  const matches = text.match(/docs\/[A-Za-z0-9_./-]+\.md/g) ?? [];
  return [...new Set(matches)];
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/**
 * Give each run of `size` words of `body` that also occurs as a run in `doc`.
 * Line breaks count as white space. Each run has one space between its words
 * and occurs one time in the result.
 */
export function sharedWordRuns(body: string, doc: string, size = 8): string[] {
  const docWords = words(doc);
  const docRuns = new Set<string>();
  for (let i = 0; i + size <= docWords.length; i += 1) {
    docRuns.add(docWords.slice(i, i + size).join(" "));
  }
  const bodyWords = words(body);
  const shared = new Set<string>();
  for (let i = 0; i + size <= bodyWords.length; i += 1) {
    const run = bodyWords.slice(i, i + size).join(" ");
    if (docRuns.has(run)) shared.add(run);
  }
  return [...shared];
}
