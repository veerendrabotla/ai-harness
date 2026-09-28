import type { z } from "zod";

/**
 * Minimal Zod → JSON Schema converter covering the constructs used by V1 tool
 * input schemas (objects, strings, numbers, booleans, enums, arrays, records,
 * defaults). Avoids an extra dependency while giving model providers real
 * parameter schemas for native tool-calling.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = String(def.typeName ?? "");

  switch (typeName) {
    case "ZodString": {
      const out: Record<string, unknown> = { type: "string" };
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      for (const check of checks) {
        if (check.kind === "min") out.minLength = check.value;
        if (check.kind === "max") out.maxLength = check.value;
      }
      return out;
    }
    case "ZodNumber": {
      const out: Record<string, unknown> = { type: "number" };
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      for (const check of checks) {
        if (check.kind === "int") out.type = "integer";
        if (check.kind === "min") out.minimum = check.value;
        if (check.kind === "max") out.maximum = check.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: def.values };
    case "ZodArray":
      return { type: "array", items: convert(def.type as z.ZodTypeAny) };
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: def.valueType ? convert(def.valueType as z.ZodTypeAny) : true,
      };
    case "ZodOptional":
      return { ...convert(def.innerType as z.ZodTypeAny), nullable: true };
    case "ZodDefault": {
      const inner = convert(def.innerType as z.ZodTypeAny);
      const dv = def.defaultValue as () => unknown;
      return { ...inner, default: dv() };
    }
    case "ZodObject": {
      const shape = def.shape as Record<string, z.ZodTypeAny> | (() => Record<string, z.ZodTypeAny>);
      const resolved = typeof shape === "function" ? shape() : shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(resolved)) {
        properties[key] = convert(value);
        const innerDef = (value as unknown as { _def: Record<string, unknown> })._def;
        if (String(innerDef.typeName) !== "ZodOptional" && String(innerDef.typeName) !== "ZodDefault") {
          required.push(key);
        }
      }
      return { type: "object", properties, required };
    }
    default:
      // Permissive fallback — validation still happens in the harness.
      return { type: "object", additionalProperties: true };
  }
}
