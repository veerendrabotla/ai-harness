/**
 * Builder Experience contracts (Track 2).
 * Defines templates, prompt-to-project creation, and builder-specific types.
 */
import { z } from "zod";

// ─── Project Templates ──────────────────────────────────────

export const templateCategorySchema = z.enum([
  "blank",
  "saas",
  "dashboard",
  "landing",
  "ecommerce",
  "admin",
  "fullstack",
  "api",
  "ai",
  "mobile",
]);

export type TemplateCategory = z.infer<typeof templateCategorySchema>;

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  tags: string[];
  frameworks: string[];
  estimatedTime: string;
  features: string[];
  prompt: string; // The base prompt to generate this template
  starterFiles?: Record<string, string>; // path -> content
  verificationCommands?: string[];
}

// ─── Prompt-to-Project ──────────────────────────────────────

export const promptToProjectRequestSchema = z.object({
  prompt: z.string().min(1).max(5000),
  templateId: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
  projectName: z.string().min(1).max(160).optional(),
  connectionType: z.enum(["CLOUD", "LOCAL_BRIDGE"]).default("LOCAL_BRIDGE"),
  bridgeId: z.string().uuid().optional(),
  rootReference: z.string().min(1).max(2000).optional(),
  preferredFramework: z.string().optional(),
  features: z.array(z.string()).optional(),
});

export type PromptToProjectRequest = z.infer<typeof promptToProjectRequestSchema>;

export interface PromptToProjectResponse {
  taskId: string;
  projectId: string;
  planId: string;
  estimatedSteps: number;
  analysis: {
    projectType: string;
    frameworks: string[];
    features: string[];
    estimatedFiles: number;
  };
}

// ─── Clarification Questions ─────────────────────────────────

export const clarificationResponseSchema = z.object({
  responses: z.array(z.object({
    questionId: z.string(),
    answer: z.string().max(2000),
  })),
});

export type ClarificationResponse = z.infer<typeof clarificationResponseSchema>;

// ─── Builder State ───────────────────────────────────────────

export type BuilderPhase =
  | "prompt"
  | "clarifying"
  | "planning"
  | "building"
  | "previewing"
  | "completed";

export interface BuilderState {
  phase: BuilderPhase;
  prompt: string;
  templateId?: string;
  projectId?: string;
  taskId?: string;
  clarifications?: Array<{
    id: string;
    question: string;
    options?: string[];
  }>;
  planSummary?: string;
  progress?: {
    currentStep: number;
    totalSteps: number;
    currentAction: string;
  };
}

// ─── Templates ───────────────────────────────────────────────

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank-nextjs",
    name: "Blank Next.js App",
    description: "A clean Next.js 15 starter with TypeScript and Tailwind CSS",
    category: "blank",
    icon: "RectangleHorizontal",
    tags: ["nextjs", "react", "typescript", "tailwind"],
    frameworks: ["Next.js", "React", "Tailwind CSS"],
    estimatedTime: "2-3 minutes",
    features: ["TypeScript", "Tailwind CSS", "App Router", "ESLint"],
    prompt: "Create a minimal Next.js 15 application with TypeScript and Tailwind CSS using the App Router. Include a homepage with a centered heading and a responsive layout.",
    verificationCommands: ["npm run build"],
  },
  {
    id: "blank-vite",
    name: "Blank Vite React App",
    description: "Lightweight React app with Vite, TypeScript, and Tailwind",
    category: "blank",
    icon: "Zap",
    tags: ["vite", "react", "typescript", "tailwind"],
    frameworks: ["Vite", "React", "Tailwind CSS"],
    estimatedTime: "1-2 minutes",
    features: ["TypeScript", "Tailwind CSS", "Fast HMR"],
    prompt: "Create a minimal React application with Vite, TypeScript, and Tailwind CSS. Include a homepage with a clean layout.",
    verificationCommands: ["npm run build"],
  },
  {
    id: "saas-starter",
    name: "SaaS Starter",
    description: "Full-stack SaaS with auth, billing dashboard, and multi-tenancy",
    category: "saas",
    icon: "Layers",
    tags: ["saas", "nextjs", "auth", "database", "stripe"],
    frameworks: ["Next.js", "React", "Prisma", "Tailwind CSS"],
    estimatedTime: "8-12 minutes",
    features: ["Authentication", "User dashboard", "Billing/Stripe", "Multi-tenancy", "Admin panel", "Database"],
    prompt: "Build a production-ready SaaS application with Next.js 15, Prisma, and PostgreSQL. Include: 1) Email/password authentication with session management, 2) User dashboard with usage stats, 3) Settings page, 4) Billing integration stub, 5) Multi-tenant workspace support. Use Tailwind CSS for styling.",
    verificationCommands: ["npm run typecheck", "npm run build"],
  },
  {
    id: "dashboard",
    name: "Analytics Dashboard",
    description: "Interactive dashboard with charts, tables, and real-time data",
    category: "dashboard",
    icon: "LayoutDashboard",
    tags: ["dashboard", "charts", "nextjs", "data"],
    frameworks: ["Next.js", "React", "Recharts", "Tailwind CSS"],
    estimatedTime: "6-8 minutes",
    features: ["Interactive charts", "Data tables", "Filters", "Responsive layout", "Dark mode"],
    prompt: "Build an analytics dashboard with Next.js 15 and Recharts. Include: 1) Overview cards with KPIs, 2) Line chart for trends, 3) Bar chart for comparisons, 4) Data table with sorting and filtering, 5) Date range selector, 6) Dark mode toggle. Use Tailwind CSS.",
    verificationCommands: ["npm run build"],
  },
  {
    id: "landing-page",
    name: "Landing Page",
    description: "Beautiful marketing landing page with sections and CTA",
    category: "landing",
    icon: "Rocket",
    tags: ["landing", "marketing", "nextjs", "animation"],
    frameworks: ["Next.js", "React", "Tailwind CSS"],
    estimatedTime: "3-5 minutes",
    features: ["Hero section", "Features grid", "Pricing table", "Testimonials", "CTA section", "Footer", "Responsive"],
    prompt: "Build a modern SaaS landing page with Next.js 15 and Tailwind CSS. Include: 1) Hero with headline, subtext, and CTA button, 2) Features grid with icons, 3) Pricing table with 3 tiers, 4) Testimonials carousel, 5) FAQ accordion, 6) Footer with links. Make it visually stunning with smooth scroll.",
    verificationCommands: ["npm run build"],
  },
  {
    id: "ecommerce",
    name: "E-Commerce Store",
    description: "Online store with product grid, cart, and checkout flow",
    category: "ecommerce",
    icon: "ShoppingBag",
    tags: ["ecommerce", "shop", "cart", "nextjs"],
    frameworks: ["Next.js", "React", "Tailwind CSS"],
    estimatedTime: "8-10 minutes",
    features: ["Product grid", "Product detail", "Shopping cart", "Checkout flow", "Search/filter", "Responsive"],
    prompt: "Build an e-commerce storefront with Next.js 15 and Tailwind CSS. Include: 1) Product listing grid with images and prices, 2) Product detail page, 3) Shopping cart with add/remove/quantity, 4) Checkout form, 5) Product search and category filtering, 6) Responsive design. Use mock data for products.",
    verificationCommands: ["npm run build"],
  },
  {
    id: "admin-panel",
    name: "Admin Panel",
    description: "Admin dashboard with CRUD operations and role-based access",
    category: "admin",
    icon: "Shield",
    tags: ["admin", "dashboard", "crud", "auth"],
    frameworks: ["Next.js", "React", "Tailwind CSS"],
    estimatedTime: "7-9 minutes",
    features: ["User management", "Data tables", "CRUD forms", "Role-based UI", "Charts", "Activity log"],
    prompt: "Build an admin panel with Next.js 15 and Tailwind CSS. Include: 1) Admin dashboard with stats, 2) User management table with CRUD, 3) Settings page, 4) Activity log, 5) Role-based navigation (admin vs editor), 6) Responsive sidebar. Use mock data.",
    verificationCommands: ["npm run build"],
  },
  {
    id: "fullstack-app",
    name: "Full-Stack App",
    description: "Complete full-stack app with API routes, database, and auth",
    category: "fullstack",
    icon: "Server",
    tags: ["fullstack", "api", "database", "auth", "nextjs"],
    frameworks: ["Next.js", "React", "Prisma", "Tailwind CSS"],
    estimatedTime: "10-14 minutes",
    features: ["API routes", "Database ORM", "Authentication", "CRUD operations", "Error handling", "Testing setup"],
    prompt: "Build a full-stack application with Next.js 15, Prisma, and SQLite. Include: 1) API routes for CRUD operations on a 'posts' resource, 2) Database schema with Prisma, 3) Authentication with next-auth, 4) Frontend pages for listing, creating, and editing posts, 5) Error boundaries, 6) Loading states. Use Tailwind CSS.",
    verificationCommands: ["npm run typecheck", "npm run build"],
  },
  {
    id: "api-service",
    name: "REST API Service",
    description: "Backend API service with Fastify, validation, and documentation",
    category: "api",
    icon: "Globe",
    tags: ["api", "rest", "fastify", "backend"],
    frameworks: ["Fastify", "TypeScript"],
    estimatedTime: "5-7 minutes",
    features: ["REST endpoints", "Request validation", "Error handling", "Rate limiting", "CORS", "API docs"],
    prompt: "Build a REST API service with Fastify and TypeScript. Include: 1) CRUD endpoints for a 'users' resource, 2) Request validation with Zod, 3) Proper error handling and status codes, 4) Rate limiting, 5) CORS configuration, 6) Health check endpoint. Include proper TypeScript types.",
    verificationCommands: ["npx tsc --noEmit"],
  },
  {
    id: "ai-app",
    name: "AI Application",
    description: "AI-powered app with streaming, chat interface, and vector search",
    category: "ai",
    icon: "Brain",
    tags: ["ai", "chat", "openai", "streaming", "nextjs"],
    frameworks: ["Next.js", "React", "Vercel AI SDK", "Tailwind CSS"],
    estimatedTime: "8-12 minutes",
    features: ["Chat interface", "Streaming responses", "Message history", "Model selection", "Code highlighting", "Markdown rendering"],
    prompt: "Build an AI chat application with Next.js 15 and the Vercel AI SDK. Include: 1) Chat interface with message bubbles, 2) Streaming response display, 3) Message history sidebar, 4) Model selector, 5) Code syntax highlighting in responses, 6) Markdown rendering. Use Tailwind CSS.",
    verificationCommands: ["npm run build"],
  },
];

export function getTemplateById(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: TemplateCategory): ProjectTemplate[] {
  return TEMPLATES.filter((t) => t.category === category);
}
