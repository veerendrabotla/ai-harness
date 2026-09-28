/** Extracts a JSON object from a model reply that may be fenced or annotated. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch (err) {
    console.error("[JSON] Initial parse failed, trying fallback:", err);
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model response did not contain parsable JSON");
  }
}
