/**
 * Stream transforms — deterministic post-processing for LLM token streams (v0 V2 pattern).
 *
 * Transforms are applied to the complete accumulated text (not per-chunk) to handle
 * cross-chunk patterns correctly. No extra LLM call is made.
 */

export interface StreamTransform {
  name: string;
  shouldApply(content: string): boolean;
  transform(chunk: string): string;
}

/**
 * Long URL compression: if a URL in the stream is >200 chars, keep it but
 * append a comment `// (long URL)` so downstream tooling can spot it.
 * Mainly pass-through but tracks long URLs.
 */
export const longUrlTransform: StreamTransform = {
  name: "long-url-compression",
  shouldApply(content: string): boolean {
    // Quick check for any http(s) URL with 200+ non-space chars after scheme
    return /https?:\/\/\S{200,}/.test(content);
  },
  transform(chunk: string): string {
    return chunk.replace(/(https?:\/\/[^\s"'`]+)/g, (url) => {
      if (url.length > 200) {
        // Avoid double-annotating if already has the comment
        if (chunk.includes(`${url} // (long URL)`)) return url;
        return `${url} // (long URL)`;
      }
      return url;
    });
  },
};

/**
 * Known hallucinated lucide-react icon names mapped to closest real icons.
 * e.g. `MailWarning as VercelLogo` is wrong — real icons are `Mail`, `AlertTriangle`, etc.
 */
const LUCIDE_ICON_MAP: Record<string, string> = {
  MailWarning: "Mail",
  VercelLogo: "Triangle",
  ShopIcon: "ShoppingBag",
  UserCircle2: "UserCircle",
  AlertCircleOutline: "AlertCircle",
  SearchX: "Search",
  HomeIcon2: "Home",
  Settings2Outline: "Settings",
};

export const importNormalizationTransform: StreamTransform = {
  name: "import-normalization",
  shouldApply(content: string): boolean {
    if (!content.includes("lucide-react")) return false;
    return Object.keys(LUCIDE_ICON_MAP).some((bad) => content.includes(bad));
  },
  transform(chunk: string): string {
    if (!chunk.includes("lucide-react")) return chunk;
    let result = chunk;
    for (const [bad, good] of Object.entries(LUCIDE_ICON_MAP)) {
      // Replace word-boundary matches to avoid partial replacements
      result = result.replace(new RegExp(`\\b${bad}\\b`, "g"), good);
    }
    return result;
  },
};

/**
 * Package version pinning: if the stream contains `npm install <pkg>` without
 * version, don't transform — just pass through. This transform is intentionally
 * a no-op to document the decision and keep the pipeline deterministic.
 */
export const packageVersionPinningTransform: StreamTransform = {
  name: "package-version-pinning",
  shouldApply(content: string): boolean {
    return /npm\s+install\s+/.test(content);
  },
  transform(chunk: string): string {
    // Intentionally no transformation — pass through unchanged.
    // If we ever decide to pin versions, this is the place.
    return chunk;
  },
};

export const defaultTransforms: StreamTransform[] = [
  longUrlTransform,
  importNormalizationTransform,
  packageVersionPinningTransform,
];

/**
 * Post-process complete generated text through the transform pipeline.
 * Applied to accumulated text, not individual chunks, to handle cross-chunk patterns.
 */
export function transformResponse(text: string): string {
  let result = text;
  for (const t of defaultTransforms) {
    if (t.shouldApply(result)) {
      result = t.transform(result);
    }
  }
  return result;
}
