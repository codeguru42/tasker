// True when version is older than minimum, compared part by part from the left.
// Both lists must have the same length.
export function isOlderVersion(version: readonly number[], minimum: readonly number[]): boolean {
  if (version.length !== minimum.length) {
    throw new RangeError(
      `the version has ${version.length} parts, but the minimum has ${minimum.length} parts`,
    );
  }
  for (const [index, part] of version.entries()) {
    if (part !== minimum[index]) return part < minimum[index];
  }
  return false;
}
