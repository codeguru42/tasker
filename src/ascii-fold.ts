// The fold changes only the ASCII letters A to Z to lower case. toLowerCase() is not safe
// for a compare of ASCII names: it maps some non-ASCII letters to ASCII letters, for
// example the Kelvin sign U+212A to "k".
export function asciiFold(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
