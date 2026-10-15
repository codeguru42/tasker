import { z } from "zod";

// The JSON Schema for claude from a zod schema. claude refuses a schema that holds $schema.
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json: Record<string, unknown> = z.toJSONSchema(schema);
  delete json.$schema;
  return json;
}
