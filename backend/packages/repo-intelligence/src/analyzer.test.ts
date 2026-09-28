import { describe, expect, it } from "vitest";
import { analyzeRepository } from "./analyzer.js";

function makeFile(path: string) {
  return { path, type: "file" as const };
}

describe("repository intelligence", () => {
  it("detects TypeScript + Next.js + React project", () => {
    const files = [
      makeFile("package.json"),
      makeFile("package-lock.json"),
      makeFile("tsconfig.json"),
      makeFile("src/app/page.tsx"),
      makeFile("src/app/layout.tsx"),
      makeFile("src/lib/utils.ts"),
      makeFile("next.config.js"),
      makeFile("tailwind.config.ts"),
    ];
    const pkg = JSON.stringify({
      name: "my-app",
      dependencies: { next: "15.0.0", react: "18.3.0", "react-dom": "18.3.0" },
      devDependencies: { typescript: "5.4.0", tailwindcss: "3.4.0", vitest: "1.0.0" },
      scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", test: "vitest" },
    });

    const analysis = analyzeRepository(files, pkg, null, null);

    expect(analysis.projectType).toBe("fullstack-application");
    expect(analysis.languages.some((l) => l.name === "TypeScript")).toBe(true);
    expect(analysis.frameworks.some((f) => f.name === "Next.js")).toBe(true);
    expect(analysis.frameworks.some((f) => f.name === "React")).toBe(true);
    expect(analysis.frameworks.some((f) => f.name === "Tailwind CSS")).toBe(true);
    expect(analysis.packageManager.name).toBe("npm");
    expect(analysis.testSetup.framework).toBe("Vitest");
    expect(analysis.conventions.tsConfig).toBe(true);
    expect(analysis.scripts.some((s) => s.purpose === "build")).toBe(true);
    expect(analysis.scripts.some((s) => s.purpose === "test")).toBe(true);
  });

  it("detects Python + Django project", () => {
    const files = [
      makeFile("requirements.txt"),
      makeFile("manage.py"),
      makeFile("settings.py"),
      makeFile("models.py"),
      makeFile("Dockerfile"),
    ];
    const analysis = analyzeRepository(files, null, null, null);

    expect(analysis.languages.some((l) => l.name === "Python")).toBe(true);
    expect(analysis.projectType).toBe("python-project");
  });

  it("detects monorepo structure", () => {
    const files = [
      makeFile("package.json"),
      makeFile("turbo.json"),
      makeFile("pnpm-workspace.yaml"),
      makeFile("packages/core/package.json"),
      makeFile("packages/ui/package.json"),
      makeFile("apps/web/package.json"),
    ];
    const pkg = JSON.stringify({
      name: "monorepo",
      workspaces: ["packages/*", "apps/*"],
    });

    const analysis = analyzeRepository(files, pkg, null, null);

    expect(analysis.structure.isMonorepo).toBe(true);
    expect(analysis.structure.packageDirs.length).toBeGreaterThanOrEqual(2);
  });

  it("detects environment requirements from .env.example", () => {
    const envExample = `DATABASE_URL=postgresql://localhost:5432/mydb
API_KEY=
SECRET_KEY=dev-secret
PORT=3000`;
    const analysis = analyzeRepository([], null, envExample, null);

    expect(analysis.envRequirements).toHaveLength(4);
    expect(analysis.envRequirements.find((e) => e.variable === "API_KEY")?.required).toBe(true);
    expect(analysis.envRequirements.find((e) => e.variable === "PORT")?.required).toBe(false);
  });

  it("detects Prisma database setup", () => {
    const files = [
      makeFile("package.json"),
      makeFile("prisma/schema.prisma"),
    ];
    const pkg = JSON.stringify({
      dependencies: { "@prisma/client": "5.0.0" },
      devDependencies: { prisma: "5.0.0" },
    });

    const analysis = analyzeRepository(files, pkg, null, null);

    expect(analysis.databaseInfo).not.toBeNull();
    expect(analysis.databaseInfo?.orm).toBe("Prisma");
    expect(analysis.databaseInfo?.configFiles).toContain("prisma/schema.prisma");
  });

  it("detects ESM module system", () => {
    const pkg = JSON.stringify({ name: "esm-pkg", type: "module" });
    const analysis = analyzeRepository([makeFile("package.json")], pkg, null, null);

    expect(analysis.conventions.moduleSystem).toBe("esm");
  });

  it("detects pnpm package manager", () => {
    const files = [makeFile("package.json"), makeFile("pnpm-lock.yaml")];
    const analysis = analyzeRepository(files, null, null, null);

    expect(analysis.packageManager.name).toBe("pnpm");
    expect(analysis.packageManager.lockFile).toBe("pnpm-lock.yaml");
  });

  it("detects yank package manager with workspaces", () => {
    const files = [makeFile("package.json"), makeFile("yarn.lock")];
    const pkg = JSON.stringify({ workspaces: ["packages/*"] });
    const analysis = analyzeRepository(files, pkg, null, null);

    expect(analysis.packageManager.name).toBe("yarn");
    expect(analysis.packageManager.workspaces).toBe(true);
  });

  it("returns low confidence for empty project", () => {
    const analysis = analyzeRepository([], null, null, null);
    expect(analysis.confidence).toBe(0);
    expect(analysis.projectType).toBe("unknown");
    expect(analysis.languages).toHaveLength(0);
  });

  it("detects multiple scripts with correct purposes", () => {
    const pkg = JSON.stringify({
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "eslint .",
        test: "vitest",
        "type-check": "tsc --noEmit",
        format: "prettier --write .",
        deploy: "vercel deploy",
      },
    });
    const analysis = analyzeRepository([makeFile("package.json")], pkg, null, null);

    const purposeMap = Object.fromEntries(analysis.scripts.map((s) => [s.name, s.purpose]));
    expect(purposeMap.dev).toBe("dev");
    expect(purposeMap.build).toBe("build");
    expect(purposeMap.start).toBe("start");
    expect(purposeMap.lint).toBe("lint");
    expect(purposeMap.test).toBe("test");
    expect(purposeMap["type-check"]).toBe("typecheck");
    expect(purposeMap.format).toBe("format");
    expect(purposeMap.deploy).toBe("deploy");
  });
});
