// Generates llms-full.txt: every root + docs/*.md concatenated, for LLM ingestion
// (one fetch gets the full documentation set; llms.txt remains the index).
// Usage: node scripts/gen-llms-full.mjs [--check]
//   --check: verify llms-full.txt matches the generated content (drift gate), no writes.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const checkOnly = process.argv.includes("--check");
const OUT = "llms-full.txt";

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".md")) out.push(full.split("\\").join("/"));
  }
  return out;
};

const roots = readdirSync(".")
  .filter((f) => f.endsWith(".md"))
  .sort();
const docs = walk("docs").sort();
const files = [...roots, ...docs];

const parts = [
  "<!-- GENERATED FILE — do not edit. Run: node scripts/gen-llms-full.mjs -->",
  "<!-- Index: llms.txt · Source files: root *.md + docs/**/*.md -->",
  "",
];
for (const file of files) {
  const content = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trimEnd();
  const lines = content.split("\n").length;
  parts.push(`<!-- ===== ${file} (${lines} lines) ===== -->`, content, "");
}
const next = parts.join("\n");

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  } catch {}
  if (current !== next) {
    console.error(`DRIFT: ${OUT} is out of sync — run: node scripts/gen-llms-full.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} OK (${files.length} docs)`);
} else {
  writeFileSync(OUT, next, "utf8");
  console.log(`${OUT} written (${files.length} docs, ${next.split("\n").length} lines)`);
}
