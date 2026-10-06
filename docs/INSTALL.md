# Install AI Harness

Every way to get AI Harness running — desktop app, one-line web-stack installer, VS Code extension, or build from source. Nothing here requires cloning the repository unless you want to develop.

Already running the web app? The same installers are served at **`/download`** (landing page → Download, or sidebar → Download when signed in).

Related: [Getting Started](getting-started.md) (first task walkthrough) · [Self-Hosting](guides/self-hosting.md) (production topology) · [Troubleshooting](troubleshooting.md)

---

## 1. Desktop app (Windows)

| Build | Download |
|---|---|
| Installer (recommended) | [AI-Harness-Setup-x64.exe](https://github.com/veerendrabotla/ai-harness/releases/latest/download/AI-Harness-Setup-x64.exe) |
| Portable (no install) | [AI-Harness-Portable-x64.exe](https://github.com/veerendrabotla/ai-harness/releases/latest/download/AI-Harness-Portable-x64.exe) |

1. Download the installer and run it (per-user install, no admin required — shortcuts land in the Start Menu and on the Desktop).
2. Point the app at a running web stack. The app opens `http://localhost:3000` by default; override with the `AI_HARNESS_FRONTEND_URL` environment variable (for example `http://localhost:3001` if 3000 is taken).
3. Auto-update: the app checks the [GitHub Releases](https://github.com/veerendrabotla/ai-harness/releases) feed on launch and installs updates on quit.

Verify any download against `SHA256SUMS.txt` in the same release:

```powershell
Get-FileHash .\AI-Harness-Setup-x64.exe -Algorithm SHA256
```

macOS and Linux installers (`AI-Harness-Setup-*.dmg`, `.AppImage`, `.deb`) are attached to every `v*` release by the `release` workflow. Builds are unsigned: on macOS, right-click → Open the first time (Gatekeeper), until an Apple Developer certificate is configured.

## 2. Web stack — one line (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.sh | bash
```

## 3. Web stack — one line (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.ps1 | iex
```

Both scripts:

- require Docker (Compose v2) and nothing else — no repository clone;
- install to `~/.ai-harness` (`%USERPROFILE%\.ai-harness` on Windows);
- pull prebuilt images from `ghcr.io` (Postgres + Redis + API + worker + gateway + frontend);
- generate a `.env` with fresh JWT/CSRF/encryption/bridge secrets;
- auto-shift ports by +100 if the defaults (3000/4000/5432/6379/4010) are busy, and shift the container-name prefix if another AI Harness stack (e.g. a from-source dev install) already owns the default names — two stacks coexist on one machine;
- wait for health, then print the URL — open `http://localhost:3000` and sign up.

```text
Stop:    docker compose -f ~/.ai-harness/docker-compose.release.yml down
Update:  docker compose -f ~/.ai-harness/docker-compose.release.yml pull && docker compose -f ~/.ai-harness/docker-compose.release.yml up -d
```

Overrides: `AI_H_INSTALL_DIR`, `AI_H_PORT_WEB/API/PG/REDIS/GW`, `AI_H_CONFIG_ONLY=1` (generate + validate without booting). Every push to `main` runs this exact path in CI (`publish-images` → `quickstart` job) against the freshly published images.

## 4. VS Code extension

| Method | How |
|---|---|
| Marketplace | Extensions view → search **AI Harness** (`ai-harness.ai-harness`) |
| Direct `.vsix` | Download `ai-harness-*.vsix` from [Releases](https://github.com/veerendrabotla/ai-harness/releases/latest), then `code --install-extension ai-harness-<version>.vsix` |

Configure `ai-harness.serverUrl` (default `http://localhost:4010`, the Bridge Gateway) and run **AI Harness: Connect to Server** from the Command Palette. See [EXTENSION_GUIDE.md](../EXTENSION_GUIDE.md).

## 5. Build from source

```bash
node scripts/setup-env.mjs      # generate .env with fresh secrets
docker compose up -d --build    # all 7 services, images built locally
```

Multi-terminal dev mode, tests, and the first-task walkthrough: [Getting Started](getting-started.md).

## 6. Hosting it for a team

### Everything on Vercel — services mode (live URL, ~10 min)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/veerendrabotla/ai-harness)

The repo's root `vercel.json` deploys three services on one domain: `frontend` (Next.js), `api` (Fastify — `/v1/*`, `/healthz`, `/docs`, `/socket.io`, `/multiplayer`) and `bridge-gateway` (`/bridge`). The api service discovers the gateway via a binding (`BRIDGE_GATEWAY_URL`, injected at runtime).

1. Import this repo (the button does it) → Settings → General → **Framework Preset = `Services`** (required: otherwise Vercel ignores the `services` key and builds a single app).
2. Project env vars (Settings → Environment Variables):
   - `NEXT_PUBLIC_API_URL=` — **leave empty**: the web app then calls same-origin `/v1/*`.
   - `FRONTEND_ORIGIN=https://<project>.vercel.app` — CORS, the CSRF Origin allowlist (the client relies on it; it sends no `X-CSRF-Token`) and socket.io origin checks.
   - `DATABASE_URL` (host-reachable Postgres), `REDIS_URL` (e.g. Upstash), `JWT_ACCESS_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `BRIDGE_INTERNAL_TOKEN` — the api build runs `prisma migrate deploy`, so `DATABASE_URL` must be set before the first deploy. Never add `BRIDGE_GATEWAY_URL` (binding-injected).
   - Optional: `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`, `SENTRY_DSN`.
3. Deploy, then copy the production domain. Same site for web + API ⇒ `SameSite=Lax` cookies just work — no `COOKIE_SAMESITE=none`.
4. OAuth redirect URIs: `https://<domain>/v1/auth/github/callback` (and Google equivalent).
5. Done — every push to `main` redeploys all three services (Vercel Git integration). Verify `https://<domain>/healthz` and `/docs`.

Not deployed to Vercel: the **worker** (long-running BullMQ consumer) — run it on any Docker host with the one-liners above or the paths in [Self-Hosting](guides/self-hosting.md); tasks simply queue until it runs. Services is a beta feature; WebSockets use Vercel's public beta (polling fallback enabled in the client).

Split-origin variant (web on Vercel, API somewhere else) is still supported: set `NEXT_PUBLIC_API_URL` to the API origin, add that origin to the API's `FRONTEND_ORIGIN`, and set the API's `COOKIE_SAMESITE=none` — the frontend mirrors the session cookie onto its own origin in code:

### Backend anywhere Docker runs

The same one-line installers on a server, or the production compose/Terraform paths in [Self-Hosting](guides/self-hosting.md).

## Status of package managers

winget / Homebrew / Chocolatey manifests and code-signing certificates are planned — they require publisher accounts (Microsoft, Apple, Homebrew). Until then, use the direct downloads above.
