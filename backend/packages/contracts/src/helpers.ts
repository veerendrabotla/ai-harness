import { z } from "zod";

/**
 * Wrap an optional field so that an empty string is treated as absent.
 *
 * HTML forms and selects submit "" for untouched optional inputs, while
 * zod's `.optional()` only accepts `undefined`. Without this, every empty
 * optional url/uuid/min-length field hard-blocks form submission (e.g. the
 * "Repository URL (optional)" input on Add project).
 */
export const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
