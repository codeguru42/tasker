// True when value is an object that is not null and not an array, for example the result of JSON.parse() of "{...}".
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
