// A file and ref name for value. Each A-Z, a-z and 0-9 stays, with its case.
// Each run of other characters becomes one "-", and the slug has no "-" at its ends.
export function pathSlug(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug === "") {
    throw new Error(`cannot make a path slug from ${JSON.stringify(value)}`);
  }
  return slug;
}
