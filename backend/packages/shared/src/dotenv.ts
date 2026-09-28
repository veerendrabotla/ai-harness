import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

/**
 * Loads the nearest `.env` walking up from the current working directory.
 * Safe to call multiple times; existing process.env values win.
 */
export function ensureEnvLoaded(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
