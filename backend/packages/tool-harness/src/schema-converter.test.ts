import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "./schema-converter.js";

describe("zod → JSON schema converter", () => {
  it("converts tool input schemas with required arrays", () => {
    const schema = z.object({
      root: z.string(),
      path: z.string(),
      staged: z.boolean().default(false),
      limit: z.number().int().min(0).optional(),
    });
    const json = zodToJsonSchema(schema) as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["root", "path"]);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["root", "path"]);
    expect(props["root"]?.type).toBe("string");
    expect(props["staged"]?.default).toBe(false);
    expect(props["limit"]?.nullable).toBe(true);
  });

  it("handles enums, arrays and records", () => {
    const json = zodToJsonSchema(
      z.object({
        method: z.enum(["GET", "POST"]),
        tags: z.array(z.string()),
        meta: z.record(z.string()),
      }),
    ) as { properties: Record<string, Record<string, unknown>> };
    const p2 = json.properties;
    expect(p2["method"]?.enum).toEqual(["GET", "POST"]);
    expect(p2["tags"]?.type).toBe("array");
    expect(p2["meta"]?.additionalProperties).toBeTruthy();
  });

  it("falls back permissively for unknown constructs", () => {
    const json = zodToJsonSchema(z.unknown() as never as z.ZodTypeAny);
    expect(json).toHaveProperty("type");
  });
});
