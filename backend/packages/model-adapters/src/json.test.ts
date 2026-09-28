import { describe, expect, it } from "vitest";
import { extractJson } from "./json.js";

describe("model output JSON extraction", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON with language tag", () => {
    expect(extractJson("```json\n{\"plan\": true}\n```")).toEqual({ plan: true });
  });

  it("extracts the JSON object embedded in prose", () => {
    const text = 'Here is my plan:\n{"analysis": "x", "steps": [1]}\nLet me know.';
    expect(extractJson(text)).toEqual({ analysis: "x", steps: [1] });
  });

  it("throws a clear error when no JSON exists", () => {
    expect(() => extractJson("no structured content here")).toThrow(/JSON/);
  });
});
