// The text ": <detail>", or an empty text when the detail is empty. It does not trim the detail.
export function detailSuffix(detail: string): string {
  return detail === "" ? "" : `: ${detail}`;
}
