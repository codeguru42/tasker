// The order of two texts by their UTF-16 code units, as the default sort of an array gives it. No locale rule applies.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
