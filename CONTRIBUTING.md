# Contributing to AI Harness

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and generate secrets (see README)
4. Start infrastructure: `npm run infra:up`
5. Run migrations: `npm run db:generate && npm run db:migrate`
6. Start dev servers: `npm run dev:api`, `npm run dev:worker`, `npm run dev:frontend`

## Development Workflow

### Branch naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — code restructuring
- `docs/description` — documentation only

### Commit messages

Follow conventional commits:

```
feat(tasks): add task template support
fix(auth): handle expired refresh tokens
refactor(permissions): simplify evaluation logic
docs(api): add endpoint reference
```

### Code style

- **TypeScript** — strict mode, no `any` (enforced by ESLint)
- **Formatting** — Prettier with defaults (run `npx prettier --write .`)
- **Imports** — use `.js` extensions for ESM imports
- **Naming** — `camelCase` for variables/functions, `PascalCase` for types/classes
- **No comments** — code should be self-documenting; only add comments when requested

### Before submitting a PR

Run the full CI check locally:

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript strict check
npm run test          # Vitest unit tests
npm run build         # Full build
```

## Project Structure

```
backend/
  apps/
    api/              Fastify REST API + WebSocket
    worker/           BullMQ task queue consumer
    bridge-gateway/   Local bridge WebSocket relay
  packages/
    contracts/        Shared Zod schemas
    shared/           Env, crypto, errors, logging
    domain/           Task state machine (XState)
    database/         Prisma client + repositories
    permission-engine/ ALLOW/ASK/DENY evaluation
    tool-harness/     Tool registry + bounded execution
    context-engine/   Budgeted context assembly
    model-adapters/   LLM provider abstraction
    agent-runtime/    Agent orchestration
    ...more

frontend/             Next.js 15 PWA
desktop/              Electron wrapper
local_bridge/         TypeScript local agent (device-token WS via gateway)
infra/terraform/      GCP infrastructure
```

## Testing

### Unit tests

```bash
npm test                    # Run all vitest tests
npx vitest run path/to.test.ts  # Run single file
```

### Integration tests

Integration tests require a running database. They are in `backend/apps/api/tests/`:

```bash
npx prisma migrate deploy --schema backend/prisma/schema.prisma
npx vitest run backend/apps/api/tests/
```

Notes:

- Suites in `backend/apps/api/tests/` probe `GET /v1/health` at collection
  time and skip themselves when the API (`:4000`) is down — start it with
  `npm run dev:api` to run them for real.
- `races.integration.test.ts` and `session-portability.integration.test.ts`
  are gated behind `RUN_INTEGRATION=1`:

```bash
RUN_INTEGRATION=1 npm test   # full suite including DB-heavy integration tests
```

- Integration suites sign up real users; local `.env` raises the auth rate
  limits (signup/login/global) so parallel workers fit inside the buckets.
  If you see `429`s in tests, check `RATE_LIMIT_*` in `.env`.

### Load tests

```bash
# Artillery (configured in loadtest.yml)
npx artillery run loadtest.yml

# k6
k6 run scripts/load-test.k6.js
```

### End-to-end tests

```bash
npm run e2e:smoke       # API smoke tests (server must be running)
npm run e2e:agent       # Full agent run
npm run e2e:browser     # Playwright browser tests
```

## Adding a New API Endpoint

1. Create route file in `backend/apps/api/src/modules/<module>/`
2. Define Zod schemas in `backend/packages/contracts/`
3. Register routes in `backend/apps/api/src/app.ts`
4. Add OpenAPI tags/descriptions via Swagger decorators
5. Add tests (unit + integration)
6. Update `docs/API.md` if adding a new module

## Adding a New Package

1. Create directory in `backend/packages/<name>/`
2. Add `package.json` with `@ai-harness/<name>` name
3. Add `tsconfig.json` extending `tsconfig.base.json`
4. Add to root `package.json` workspaces array
5. Follow the dependency graph in ARCHITECTURE.md — no circular deps

## Reporting Issues

Use GitHub Issues with the appropriate template. Include:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant logs (redact secrets)

## License

By contributing, you agree that your contributions will be licensed under the project's license.
