const LOCK = ".lock";

export function pathSlug(value: string): string {
  let slug = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  while (slug.endsWith(LOCK)) {
    slug = slug.slice(0, -LOCK.length).replace(/[-.]+$/, "");
  }
  if (slug === "") {
    throw new Error(`cannot make a path slug from ${JSON.stringify(value)}`);
  }
  return slug;
}
