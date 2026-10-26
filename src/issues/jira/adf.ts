// The input of adfToText() is not an ADF document.
export class AdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdfError";
  }
}

// Turns an ADF document into plain text.
export function adfToText(value: unknown): string {
  throw new Error(`not implemented for ${typeof value}`);
}
