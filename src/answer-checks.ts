// The message of a text that is too short to hold real content.
export const PLACEHOLDER = "is a placeholder, not real text";

// True when the text is too short to hold real content.
export function isPlaceholder(text: string): boolean {
  return text.trim().length < 3;
}

// The clean step of one path: a trim, then no leading "./".
export function cleanPath(path: string): string {
  return path.trim().replace(/^\.\//, "");
}
