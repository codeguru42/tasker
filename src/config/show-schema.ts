import { z } from "zod";
import { buildConfigSchema } from "./schema.js";

type JsonSchemaNode = Record<string, unknown>;

interface ConfigSchemaEntry {
  path: string;
  type: string;
  required: boolean;
  description: string;
  acceptedValues?: unknown[];
  default?: unknown;
  provider?: string;
  constraints?: Record<string, unknown>;
}

const constraintNames = [
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "minimum",
  "exclusiveMinimum",
  "maximum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

function schemaType(schema: JsonSchemaNode): string {
  if (typeof schema.type === "string") return schema.type;
  const branches = (schema.oneOf ?? schema.anyOf) as JsonSchemaNode[] | undefined;
  if (branches?.[0] !== undefined) return schemaType(branches[0]);
  if (typeof schema.const === "string") return "string";
  if (typeof schema.const === "number") return "number";
  if (typeof schema.const === "boolean") return "boolean";
  const enumValue: unknown = schema.enum;
  if (Array.isArray(enumValue) && enumValue.length > 0) {
    const value: unknown = enumValue[0];
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
  }
  return "object";
}

function finiteValues(schema: JsonSchemaNode): unknown[] | undefined {
  const enumValue: unknown = schema.enum;
  if (Array.isArray(enumValue)) return enumValue as unknown[];
  if (Object.hasOwn(schema, "const")) return [schema.const];
  return undefined;
}

function constraintsOf(schema: JsonSchemaNode): Record<string, unknown> | undefined {
  const constraints = Object.fromEntries(
    constraintNames.flatMap((key) => {
      if (!Object.hasOwn(schema, key)) return [];
      const value = schema[key];
      if (key === "maximum" && value === Number.MAX_SAFE_INTEGER) return [];
      return [[key, value]];
    }),
  );
  const itemSchema = asNode(schema.items);
  if (itemSchema !== undefined) {
    const itemConstraints = constraintsOf(itemSchema);
    if (itemConstraints !== undefined) constraints.items = itemConstraints;
  }
  return Object.keys(constraints).length === 0 ? undefined : constraints;
}

function asNode(value: unknown): JsonSchemaNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonSchemaNode) : undefined;
}

function schemaEntries(schema: JsonSchemaNode): ConfigSchemaEntry[] {
  const entries: ConfigSchemaEntry[] = [];

  function visit(node: JsonSchemaNode, path: string, required: boolean): void {
    if (path !== "") {
      const description = typeof node.description === "string" ? node.description : "";
      const entry: ConfigSchemaEntry = {
        path,
        type: schemaType(node),
        required: node.required === false ? false : required,
        description,
      };
      const acceptedValues = finiteValues(node);
      if (acceptedValues !== undefined) entry.acceptedValues = acceptedValues;
      if (Object.hasOwn(node, "default")) entry.default = node.default;
      if (Object.hasOwn(node, "effectiveDefault")) entry.default = node.effectiveDefault;
      if (typeof node.provider === "string") entry.provider = node.provider;
      const constraints = constraintsOf(node);
      if (constraints !== undefined) entry.constraints = constraints;
      entries.push(entry);
    }

    const branches = (node.oneOf ?? node.anyOf) as unknown[] | undefined;
    if (branches?.length) {
      const selected = asNode(branches[0]);
      if (selected !== undefined) visitChildren(selected, path);
      return;
    }
    visitChildren(node, path);
  }

  function visitChildren(node: JsonSchemaNode, path: string): void {
    const properties = asNode(node.properties);
    const required = Array.isArray(node.required) ? node.required : [];
    if (properties !== undefined) {
      for (const [key, value] of Object.entries(properties)) {
        const child = asNode(value);
        if (child === undefined) continue;
        visit(child, path === "" ? key : `${path}.${key}`, required.includes(key));
      }
      return;
    }

    const valueSchema = asNode(node.additionalProperties);
    if (valueSchema !== undefined) {
      const placeholder = path === "trackers" ? "<name>" : "<key>";
      visit(valueSchema, `${path}.${placeholder}`, true);
    }
  }

  visit(schema, "", true);
  return entries;
}

export function configSchemaEntries(keyPath?: string): ConfigSchemaEntry[] {
  const schema = z.toJSONSchema(buildConfigSchema(process.env, process.env.HOME ?? "/"), {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchemaNode;
  const entries = schemaEntries(schema);
  if (keyPath === undefined) return entries;
  const selected = entries.filter((entry) => entry.path === keyPath || entry.path.startsWith(`${keyPath}.`));
  return selected;
}
