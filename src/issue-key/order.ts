import { compareText } from "../compare-text.js";

function splitKey(key: string): { text: string; digits: string | undefined } {
  const match = /^(.*?)(\d+)$/s.exec(key);
  return match === null ? { text: key, digits: undefined } : { text: match[1], digits: match[2] };
}

// Compares two numbers that are digit strings, without a conversion to Number, so that a very long number stays exact.
function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  return x.length !== y.length ? x.length - y.length : compareText(x, y);
}

// The order of two issue keys: the text before the trailing number as plain text, then the trailing number as a
// number, so #9 comes before #10. A key with no trailing number sorts by its text only, before a key with the same
// text and a number. Two numbers of the same value (for example 7 and 007) fall back to plain text order.
export function compareIssueKeys(a: string, b: string): number {
  const x = splitKey(a);
  const y = splitKey(b);
  const text = compareText(x.text, y.text);
  if (text !== 0) return text;
  if (x.digits === undefined || y.digits === undefined) {
    return x.digits === y.digits ? 0 : x.digits === undefined ? -1 : 1;
  }
  return compareDigits(x.digits, y.digits) || compareText(a, b);
}
