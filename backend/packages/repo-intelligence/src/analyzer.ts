/**
 * Repository Intelligence — analyzes project structure, frameworks, and conventions.
 * This module produces a structured understanding of a repository that the
 * orchestrator uses during GATHERING_CONTEXT to build a meaningful context package.
 */

export interface RepoAnalysis {
  projectType: string;
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  packageManager: PackageManagerInfo;
  structure: ProjectStructure;
  dependencies: DependencyInfo;
  scripts: ScriptInfo[];
  conventions: ConventionInfo;
  entryPoints: string[];
  testSetup: TestSetupInfo;
  databaseInfo: DatabaseInfo | null;
  apiArchitecture: ApiArchitectureInfo | null;
  envRequirements: EnvRequirement[];
  confidence: number;
}

export interface LanguageInfo {
  name: string;
  version: string | null;
  fileCount: number;
  primaryExtensions: string[];
}

export interface FrameworkInfo {
  name: string;
  version: string | null;
  type: "frontend" | "backend" | "fullstack" | "mobile" | "testing" | "build" | "css" | "orm" | "auth";
  confidence: number;
}

export interface PackageManagerInfo {
  name: "npm" | "pnpm" | "yarn" | "bun" | "pip" | "poetry" | "cargo" | "go" | "maven" | "gradle" | "unknown";
  lockFile: string | null;
  workspaces: boolean;
}

export interface ProjectStructure {
  srcDir: string | null;
  testDir: string | null;
  configDir: string | null;
  distDir: string | null;
  isMonorepo: boolean;
  packageDirs: string[];
  topLevelDirs: string[];
}

export interface DependencyInfo {
  production: Record<string, string>;
  development: Record<string, string>;
  total: number;
}

export interface ScriptInfo {
  name: string;
  command: string;
  purpose: "build" | "test" | "lint" | "start" | "dev" | "deploy" | "typecheck" | "format" | "other";
}

export interface ConventionInfo {
  styleGuide: string | null;
  lintConfig: string | null;
  formatConfig: string | null;
  tsConfig: boolean;
  moduleSystem: "esm" | "cjs" | "mixed" | "unknown";
  importStyle: "relative" | "alias" | "mixed" | "unknown";
}

export interface TestSetupInfo {
  framework: string | null;
  hasTests: boolean;
  testPattern: string | null;
  coverageConfig: boolean;
}

export interface DatabaseInfo {
  type: string;
  orm: string | null;
  configFiles: string[];
}

export interface ApiArchitectureInfo {
  type: string;
  framework: string | null;
  restEndpoints: boolean;
  graphql: boolean;
}

export interface EnvRequirement {
  variable: string;
  description: string | null;
  required: boolean;
  source: "env.example" | "env.template" | "code-analysis" | "config-file";
}

// ─── Framework detection rules ──────────────────────────────

interface FrameworkRule {
  name: string;
  type: FrameworkInfo["type"];
  patterns: Array<{ field: "dependencies" | "devDependencies" | "files" | "imports"; match: string | RegExp }>;
  versionPath?: string;
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  // Frontend
  { name: "React", type: "frontend", patterns: [{ field: "dependencies", match: "react" }, { field: "dependencies", match: "react-dom" }] },
  { name: "Next.js", type: "fullstack", patterns: [{ field: "dependencies", match: "next" }] },
  { name: "Vue", type: "frontend", patterns: [{ field: "dependencies", match: "vue" }] },
  { name: "Nuxt", type: "fullstack", patterns: [{ field: "dependencies", match: "nuxt" }] },
  { name: "Svelte", type: "frontend", patterns: [{ field: "dependencies", match: "svelte" }] },
  { name: "Angular", type: "frontend", patterns: [{ field: "dependencies", match: "@angular/core" }] },
  { name: "Tailwind CSS", type: "css", patterns: [{ field: "dependencies", match: "tailwindcss" }, { field: "devDependencies", match: "tailwindcss" }] },
  { name: "shadcn/ui", type: "frontend", patterns: [{ field: "files", match: "components/ui" }] },

  // Backend
  { name: "Express", type: "backend", patterns: [{ field: "dependencies", match: "express" }] },
  { name: "Fastify", type: "backend", patterns: [{ field: "dependencies", match: "fastify" }] },
  { name: "NestJS", type: "backend", patterns: [{ field: "dependencies", match: "@nestjs/core" }] },
  { name: "Koa", type: "backend", patterns: [{ field: "dependencies", match: "koa" }] },
  { name: "Hono", type: "backend", patterns: [{ field: "dependencies", match: "hono" }] },
  { name: "tRPC", type: "backend", patterns: [{ field: "dependencies", match: "@trpc/server" }] },

  // Database / ORM
  { name: "Prisma", type: "orm", patterns: [{ field: "dependencies", match: "@prisma/client" }, { field: "devDependencies", match: "prisma" }] },
  { name: "Drizzle", type: "orm", patterns: [{ field: "dependencies", match: "drizzle-orm" }] },
  { name: "TypeORM", type: "orm", patterns: [{ field: "dependencies", match: "typeorm" }] },
  { name: "Mongoose", type: "orm", patterns: [{ field: "dependencies", match: "mongoose" }] },
  { name: "Sequelize", type: "orm", patterns: [{ field: "dependencies", match: "sequelize" }] },

  // Auth
  { name: "NextAuth.js", type: "auth", patterns: [{ field: "dependencies", match: "next-auth" }] },
  { name: "Clerk", type: "auth", patterns: [{ field: "dependencies", match: "@clerk/nextjs" }, { field: "dependencies", match: "@clerk/clerk-react" }] },
  { name: "Auth.js", type: "auth", patterns: [{ field: "dependencies", match: "@auth/core" }] },

  // Testing
  { name: "Jest", type: "testing", patterns: [{ field: "devDependencies", match: "jest" }] },
  { name: "Vitest", type: "testing", patterns: [{ field: "devDependencies", match: "vitest" }] },
  { name: "Playwright", type: "testing", patterns: [{ field: "devDependencies", match: "@playwright/test" }] },
  { name: "Cypress", type: "testing", patterns: [{ field: "devDependencies", match: "cypress" }] },
  { name: "React Testing Library", type: "testing", patterns: [{ field: "devDependencies", match: "@testing-library/react" }] },

  // Build
  { name: "Vite", type: "build", patterns: [{ field: "devDependencies", match: "vite" }] },
  { name: "webpack", type: "build", patterns: [{ field: "devDependencies", match: "webpack" }] },
  { name: "esbuild", type: "build", patterns: [{ field: "devDependencies", match: "esbuild" }] },
  { name: "Rollup", type: "build", patterns: [{ field: "devDependencies", match: "rollup" }] },
  { name: "Turbopack", type: "build", patterns: [{ field: "dependencies", match: "turbo" }, { field: "files", match: "turbo.json" }] },

  // Language support
  { name: "TypeScript", type: "build", patterns: [{ field: "devDependencies", match: "typescript" }, { field: "files", match: "tsconfig.json" }] },
];

// ─── Main analysis function ─────────────────────────────────

export function analyzeRepository(
  files: Array<{ path: string; type: "file" | "directory" }>,
  packageJsonContent: string | null,
  envExampleContent: string | null,
  _readmeContent: string | null,
): RepoAnalysis {
  const pkg = packageJsonContent ? safeParseJson(packageJsonContent) : null;
  const fileTree = files.map((f) => f.path);

  const languages = detectLanguages(fileTree);
  const frameworks = detectFrameworks(pkg, fileTree);
  const packageManager = detectPackageManager(pkg, fileTree);
  const structure = analyzeStructure(fileTree, pkg);
  const dependencies = extractDependencies(pkg);
  const scripts = extractScripts(pkg);
  const conventions = detectConventions(fileTree, pkg);
  const entryPoints = findEntryPoints(pkg, fileTree);
  const testSetup = detectTestSetup(pkg, fileTree, frameworks);
  const databaseInfo = detectDatabase(frameworks, pkg, fileTree);
  const apiArchitecture = detectApiArchitecture(frameworks, pkg);
  const envRequirements = analyzeEnvRequirements(envExampleContent, pkg, fileTree);
  const confidence = calculateConfidence(languages, frameworks, dependencies);

  return {
    projectType: inferProjectType(frameworks, languages, structure),
    languages,
    frameworks,
    packageManager,
    structure,
    dependencies,
    scripts,
    conventions,
    entryPoints,
    testSetup,
    databaseInfo,
    apiArchitecture,
    envRequirements,
    confidence,
  };
}

// ─── Detection functions ────────────────────────────────────

function safeParseJson(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content) as Record<string, unknown>; }
  catch (err) { console.error("[Analyzer] JSON parse failed:", err); return null; }
}

function detectLanguages(files: string[]): LanguageInfo[] {
  const extCounts: Record<string, number> = {};
  for (const f of files) {
    if (f.includes("node_modules") || f.includes(".git/")) continue;
    const ext = f.split(".").pop()?.toLowerCase();
    if (!ext) continue;
    extCounts[ext] = (extCounts[ext] ?? 0) + 1;
  }

  const extToLang: Record<string, { name: string; version: string | null }> = {
    ts: { name: "TypeScript", version: null },
    tsx: { name: "TypeScript", version: null },
    js: { name: "JavaScript", version: null },
    jsx: { name: "JavaScript", version: null },
    mjs: { name: "JavaScript", version: null },
    cjs: { name: "JavaScript", version: null },
    py: { name: "Python", version: null },
    rb: { name: "Ruby", version: null },
    go: { name: "Go", version: null },
    rs: { name: "Rust", version: null },
    java: { name: "Java", version: null },
    kt: { name: "Kotlin", version: null },
    swift: { name: "Swift", version: null },
    cs: { name: "C#", version: null },
    cpp: { name: "C++", version: null },
    c: { name: "C", version: null },
    php: { name: "PHP", version: null },
    sql: { name: "SQL", version: null },
    html: { name: "HTML", version: null },
    css: { name: "CSS", version: null },
    scss: { name: "SCSS", version: null },
    json: { name: "JSON", version: null },
    yaml: { name: "YAML", version: null },
    yml: { name: "YAML", version: null },
    md: { name: "Markdown", version: null },
    graphql: { name: "GraphQL", version: null },
    prisma: { name: "Prisma Schema", version: null },
    toml: { name: "TOML", version: null },
    dockerfile: { name: "Dockerfile", version: null },
  };

  const langMap: Record<string, LanguageInfo> = {};
  for (const [ext, count] of Object.entries(extCounts)) {
    const info = extToLang[ext];
    if (!info) continue;
    const existing = langMap[info.name];
    if (!existing) {
      langMap[info.name] = { name: info.name, version: info.version, fileCount: count, primaryExtensions: [ext] };
    } else {
      existing.fileCount += count;
      if (!existing.primaryExtensions.includes(ext)) {
        existing.primaryExtensions.push(ext);
      }
    }
  }

  return Object.values(langMap).sort((a, b) => b.fileCount - a.fileCount);
}

function detectFrameworks(pkg: Record<string, unknown> | null, files: string[]): FrameworkInfo[] {
  if (!pkg) return [];

  const allDeps = {
    dependencies: (pkg.dependencies ?? {}) as Record<string, string>,
    devDependencies: (pkg.devDependencies ?? {}) as Record<string, string>,
  };

  const detected: FrameworkInfo[] = [];

  for (const rule of FRAMEWORK_RULES) {
    let matched = false;
    for (const pattern of rule.patterns) {
      if (pattern.field === "files") {
        if (files.some((f) => f.includes(pattern.match as string))) { matched = true; break; }
      } else {
        const deps = allDeps[pattern.field as "dependencies" | "devDependencies"];
        if (deps && typeof pattern.match === "string" && pattern.match in deps) {
          matched = true;
          break;
        }
      }
    }
    if (matched) {
      let version: string | null = null;
      const deps = { ...allDeps.dependencies, ...allDeps.devDependencies };
      if (typeof rule.name === "string") {
        const pkgName = Object.keys(deps).find((k) => k === rule.patterns[0]?.match);
        if (pkgName) version = deps[pkgName] ?? null;
      }
      detected.push({ name: rule.name, version, type: rule.type, confidence: 0.9 });
    }
  }

  return detected;
}

function detectPackageManager(pkg: Record<string, unknown> | null, files: string[]): PackageManagerInfo {
  const hasLock = (name: string) => files.some((f) => f.endsWith(name));

  if (hasLock("pnpm-lock.yaml")) return { name: "pnpm", lockFile: "pnpm-lock.yaml", workspaces: !!pkg?.pnpm };
  if (hasLock("yarn.lock")) return { name: "yarn", lockFile: "yarn.lock", workspaces: !!pkg?.workspaces };
  if (hasLock("bun.lockb") || hasLock("bun.lock")) return { name: "bun", lockFile: "bun.lockb", workspaces: false };
  if (hasLock("package-lock.json")) return { name: "npm", lockFile: "package-lock.json", workspaces: !!pkg?.workspaces };
  if (hasLock("Pipfile.lock") || hasLock("poetry.lock")) return { name: hasLock("poetry.lock") ? "poetry" : "pip", lockFile: hasLock("poetry.lock") ? "poetry.lock" : "Pipfile.lock", workspaces: false };
  if (hasLock("Cargo.lock")) return { name: "cargo", lockFile: "Cargo.lock", workspaces: false };
  if (hasLock("go.sum")) return { name: "go", lockFile: "go.sum", workspaces: false };
  return { name: "unknown", lockFile: null, workspaces: false };
}

function analyzeStructure(files: string[], pkg: Record<string, unknown> | null): ProjectStructure {
  const topLevel = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length > 1) topLevel.add(parts[0]!);
  }

  const isMonorepo = !!(
    pkg?.workspaces ||
    files.some((f) => f === "turbo.json" || f === "lerna.json" || f === "nx.json") ||
    [...topLevel].filter((d) => d === "packages" || d === "apps" || d === "libs").length > 0
  );

  const packageDirs = files
    .filter((f) => f.endsWith("package.json"))
    .map((f) => f.replace("/package.json", "").replace("package.json", "."))
    .filter((d) => d !== "." || isMonorepo);

  return {
    srcDir: topLevel.has("src") ? "src" : topLevel.has("app") ? "app" : null,
    testDir: topLevel.has("test") ? "test" : topLevel.has("tests") ? "tests" : topLevel.has("__tests__") ? "__tests__" : null,
    configDir: topLevel.has("config") ? "config" : null,
    distDir: topLevel.has("dist") ? "dist" : topLevel.has("build") ? "build" : topLevel.has(".next") ? ".next" : null,
    isMonorepo,
    packageDirs,
    topLevelDirs: [...topLevel].sort(),
  };
}

function extractDependencies(pkg: Record<string, unknown> | null): DependencyInfo {
  const prod = (pkg?.dependencies ?? {}) as Record<string, string>;
  const dev = (pkg?.devDependencies ?? {}) as Record<string, string>;
  return { production: prod, development: dev, total: Object.keys(prod).length + Object.keys(dev).length };
}

function extractScripts(pkg: Record<string, unknown> | null): ScriptInfo[] {
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const purposeMap: Record<string, ScriptInfo["purpose"]> = {
    build: "build", compile: "build", bundle: "build",
    test: "test", "test:unit": "test", "test:e2e": "test", vitest: "test", jest: "test",
    lint: "lint", "lint:fix": "lint", eslint: "lint",
    start: "start", serve: "start",
    dev: "dev", development: "dev", watch: "dev",
    deploy: "deploy", "deploy:prod": "deploy",
    typecheck: "typecheck", "type-check": "typecheck", tsc: "typecheck",
    format: "format", prettier: "format",
  };

  return Object.entries(scripts).map(([name, command]) => ({
    name,
    command,
    purpose: purposeMap[name] ?? (name.includes("test") ? "test" : name.includes("lint") ? "lint" : "other"),
  }));
}

function detectConventions(files: string[], pkg: Record<string, unknown> | null): ConventionInfo {
  const hasFile = (name: string) => files.some((f) => f.endsWith(name) || f.endsWith(`/${name}`));

  return {
    styleGuide: hasFile(".eslintrc") || hasFile(".eslintrc.js") || hasFile(".eslintrc.json") ? "eslint" : hasFile(".stylelintrc") ? "stylelint" : null,
    lintConfig: hasFile(".eslintrc") || hasFile(".eslintrc.js") || hasFile("eslint.config.js") || hasFile("eslint.config.mjs") ? "present" : null,
    formatConfig: hasFile(".prettierrc") || hasFile(".prettierrc.js") || hasFile("prettier.config.js") ? "prettier" : null,
    tsConfig: hasFile("tsconfig.json"),
    moduleSystem: detectModuleSystem(pkg, files),
    importStyle: detectImportStyle(files),
  };
}

function detectModuleSystem(pkg: Record<string, unknown> | null, files: string[]): "esm" | "cjs" | "mixed" | "unknown" {
  if (pkg?.type === "module") return "esm";
  if (pkg?.type === "commonjs") return "cjs";
  const hasCjs = files.some((f) => f.endsWith(".cjs"));
  const hasMjs = files.some((f) => f.endsWith(".mjs"));
  if (hasCjs && hasMjs) return "mixed";
  if (hasMjs) return "esm";
  return "unknown";
}

function detectImportStyle(files: string[]): "relative" | "alias" | "mixed" | "unknown" {
  const hasTsconfig = files.some((f) => f === "tsconfig.json");
  const hasPathAliases = files.some((f) => f.includes("tsconfig.paths") || f.includes("paths.json"));
  if (hasPathAliases) return "alias";
  if (hasTsconfig) return "alias"; // Most tsconfig setups use path aliases
  return "relative";
}

function findEntryPoints(pkg: Record<string, unknown> | null, files: string[]): string[] {
  const entryPoints: string[] = [];
  if (pkg?.main) entryPoints.push(String(pkg.main));
  if (pkg?.bin) {
    const bin = pkg.bin;
    if (typeof bin === "string") entryPoints.push(bin);
    else if (typeof bin === "object") entryPoints.push(...Object.values(bin as Record<string, string>));
  }

  const commonEntries = ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "app/page.tsx", "pages/index.tsx", "index.ts", "index.js"];
  for (const e of commonEntries) {
    if (files.includes(e) && !entryPoints.includes(e)) entryPoints.push(e);
  }

  return entryPoints;
}

function detectTestSetup(pkg: Record<string, unknown> | null, files: string[], frameworks: FrameworkInfo[]): TestSetupInfo {
  const testFramework = frameworks.find((f) => f.type === "testing");
  const hasTests = files.some((f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__/"));
  const testPattern = hasTests ? (files.find((f) => f.includes(".test."))?.includes(".test.") ? "**/*.test.*" : "**/*.spec.*") : null;

  return {
    framework: testFramework?.name ?? null,
    hasTests,
    testPattern,
    coverageConfig: !!(pkg?.jest || pkg?.vitest || files.some((f) => f.includes("coverage"))),
  };
}

function detectDatabase(frameworks: FrameworkInfo[], pkg: Record<string, unknown> | null, files: string[]): DatabaseInfo | null {
  const orm = frameworks.find((f) => f.type === "orm");
  const hasDbConfig = files.some((f) =>
    f.includes("schema.prisma") || f.includes("drizzle.config") || f.includes("ormconfig") || f.includes("database.yml")
  );

  if (!orm && !hasDbConfig) return null;

  const configFiles = files.filter((f) =>
    f.includes("schema.prisma") || f.includes("drizzle.config") || f.includes("ormconfig") ||
    f.includes("database.yml") || f.includes("knexfile")
  );

  return {
    type: orm?.name === "Prisma" ? "prisma" : orm?.name === "Drizzle" ? "drizzle" : "unknown",
    orm: orm?.name ?? null,
    configFiles,
  };
}

function detectApiArchitecture(frameworks: FrameworkInfo[], pkg: Record<string, unknown> | null): ApiArchitectureInfo | null {
  const backendFrameworks = frameworks.filter((f) => f.type === "backend" || f.type === "fullstack");
  if (backendFrameworks.length === 0) return null;

  const deps = pkg ? { ...((pkg.dependencies ?? {}) as Record<string, string>), ...((pkg.devDependencies ?? {}) as Record<string, string>) } : {};
  const hasGraphql = "graphql" in deps || "@apollo/server" in deps || "@apollo/client" in deps;

  return {
    type: hasGraphql ? "graphql" : "rest",
    framework: backendFrameworks[0]?.name ?? null,
    restEndpoints: !hasGraphql,
    graphql: hasGraphql,
  };
}

function analyzeEnvRequirements(
  envExampleContent: string | null,
  _pkg: Record<string, unknown> | null,
  _files: string[],
): EnvRequirement[] {
  const requirements: EnvRequirement[] = [];

  if (envExampleContent) {
    const lines = envExampleContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      requirements.push({
        variable: key,
        description: null,
        required: !value, // Empty value = required
        source: "env.example",
      });
    }
  }

  return requirements;
}

function inferProjectType(
  frameworks: FrameworkInfo[],
  languages: LanguageInfo[],
  _structure: ProjectStructure,
): string {
  const hasFrontend = frameworks.some((f) => f.type === "frontend");
  const hasBackend = frameworks.some((f) => f.type === "backend");
  const isFullstack = frameworks.some((f) => f.type === "fullstack");

  if (isFullstack) return "fullstack-application";
  if (hasFrontend && hasBackend) return "fullstack-application";
  if (hasFrontend) return "frontend-application";
  if (hasBackend) return "backend-service";
  if (languages.some((l) => l.name === "Python")) return "python-project";
  if (languages.some((l) => l.name === "Go")) return "go-project";
  if (languages.some((l) => l.name === "Rust")) return "rust-project";
  return "unknown";
}

function calculateConfidence(languages: LanguageInfo[], frameworks: FrameworkInfo[], dependencies: DependencyInfo): number {
  let confidence = 0;
  if (languages.length > 0) confidence += 0.3;
  if (frameworks.length > 0) confidence += 0.3;
  if (dependencies.total > 0) confidence += 0.2;
  if (frameworks.length > 2) confidence += 0.1;
  if (languages.length > 1) confidence += 0.1;
  return Math.min(confidence, 1);
}
