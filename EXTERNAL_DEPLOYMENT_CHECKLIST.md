# EXTERNAL DEPLOYMENT CHECKLIST

Everything below requires **your** accounts/credentials. All code, configs and scripts are already prepared — follow top to bottom. Estimated manual time: ~45–60 min.

---

## 1. Prerequisites (one-time)

| Item | Where | Notes |
|---|---|---|
| GCP project + billing | console.cloud.google.com | Owner or Editor + Billing Admin |
| GitHub repo with this code | github.com | main branch |
| Resend account | resend.com | for password-reset / invite emails |
| (optional) Sentry + PostHog accounts | sentry.io / posthog.com | observability |

Install once locally: `gcloud` CLI + `terraform` ≥1.11.4.

---

## 2. GCP bootstrap (≈15 min)

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>

# Enable APIs
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  artifactregistry.googleapis.com iamcredentials.googleapis.com cloudkms.googleapis.com

# Terraform state bucket
gsutil mb -l us-central1 gs://<PROJECT_ID>-tfstate
```

## 3. Workload-identity federation for GitHub (≈10 min)

```bash
gcloud iam workloads-identity-pools create github --location=global
gcloud iam workloads-identity-pools providers create-oidc github-oidc \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='<ORG/REPO>'"
```
Create SA `github-deployer`, grant: `roles/artifactregistry.writer`, `roles/run.admin`,
`roles/iam.serviceAccountUser`, `roles/cloudsql.admin`, `roles/redis.admin`.
Copy the provider + SA emails → GitHub secrets `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`.

## 4. Repository secrets / variables (GitHub → Settings → Secrets)

Secrets:
- `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`
- `TF_VAR_db_password`, `TF_VAR_jwt_access_secret` (48B base64), `TF_VAR_csrf_secret` (48B base64), `TF_VAR_encryption_key` (32B base64), `TF_VAR_bridge_internal_token`

Variables:
- `GCP_PROJECT_ID`, `GCP_REGION`

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT / CSRF / BRIDGE token
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
openssl rand -hex 16                                                          # db password
```

## 5. Deploy (one click)

GitHub → Actions → **deploy** → Run workflow (environment `production` = manual approval).
Pipeline: builds/pushes api+worker+gateway images → terraform apply (SQL, Redis, Cloud Run).

## 6. Frontend hosting (Vercel, ≈10 min)

Import the repo on Vercel → framework Next.js → root dir `frontend`.
Env: `NEXT_PUBLIC_API_URL=https://<api-run-url>`.
Deploy. Add the Vercel domain to API env `FRONTEND_ORIGIN` (redeploy api) — edit in `infra/terraform/cloudrun.tf` common_env or via Cloud Run console.

## 7. Post-deploy verification (≈5 min)

```bash
API=https://<api-url>
curl -s $API/healthz                                   # {"status":"ok",...}
curl -s $API/docs | head -1                            # Swagger UI HTML
npx tsx scripts/smoke-vertical-slice.ts $API           # all PASS
```
Then in the app: signup → connect a provider (or pair a bridge) → create workspace/project → run one real task end-to-end.

## 8. Optional integrations

- **Emails:** add `RESEND_API_KEY` + verified `RESEND_FROM` to Cloud Run api service; resend verification email flow.
- **Sentry:** set `SENTRY_DSN` on api+worker services.
- **PostHog:** set `NEXT_PUBLIC_POSTHOG_KEY` (+ host) on Vercel.

## 9. Rollback

Cloud Run revision traffic split (console or `gcloud run services update-traffic`); images are immutable per SHA tag.
