// Regenerates the workspace-manifest COPY block in the backend Dockerfiles.
// Line-based: drops any existing manifest COPY lines, inserts the full block
// right before the npm ci step. Safe to re-run.
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkgs = [];
for (const group of ["backend/apps", "backend/packages"]) {
  for (const name of readdirSync(group)) {
    const file = join(group, name, "package.json");
    if (existsSync(file)) pkgs.push(file.split("\\").join("/"));
  }
}
pkgs.sort();

const header = [
  "# All workspace manifests — npm must see the full workspace set so it links",
  "# every @ai-harness/* package into node_modules (esbuild and runtime resolve",
  "# through those links). Keep in sync with the workspaces globs in package.json.",
];

const isManifestCopy = (line) =>
  /^COPY .*package\.json /.test(line) &&
  !line.startsWith("COPY package.json") &&
  line.trimEnd().endsWith("/");

for (const df of ["Dockerfile.api", "Dockerfile.worker", "Dockerfile.gateway"]) {
  const lines = readFileSync(df, "utf8").split(/\r?\n/);
  const kept = lines.filter((line) => !isManifestCopy(line));
  const ciIdx = kept.findIndex((line) => line.includes("npm ci --no-audit"));
  if (ciIdx === -1) {
    console.log(`NO npm ci step: ${df}`);
    process.exit(1);
  }
  const block = pkgs.map((file) => `COPY ${file} ${file.slice(0, file.lastIndexOf("/"))}/`);
  kept.splice(ciIdx, 0, ...header, ...block);
  writeFileSync(df, kept.join("\n"));
  console.log(`${df} -> ${pkgs.length} manifests`);
}
