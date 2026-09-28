# ── Cloud Run services ─────────────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  name     = "ai-harness-api"
  location = var.region
  template {
    containers {
      image = "${local.image_base}/api:${var.image_tag}"
      env   = concat(local.common_env, [
        { name = "FRONTEND_ORIGIN", value = var.frontend_origin },
        { name = "API_BASE_URL", value = var.api_base_url },
      ])
      resources { limits = { cpu = "1", memory = "512Mi" } }
    }
    service_account = google_service_account.runtime.email
  }
  depends_on = [google_project_iam_member.run_invoker_sa]
}

resource "google_cloud_run_v2_service" "worker" {
  name     = "ai-harness-worker"
  location = var.region
  template {
    containers {
      image = "${local.image_base}/worker:${var.image_tag}"
      env   = local.common_env
      resources { limits = { cpu = "1", memory = "512Mi" } }
    }
    service_account = google_service_account.runtime.email
  }
}

resource "google_cloud_run_v2_service" "gateway" {
  name     = "ai-harness-gateway"
  location = var.region
  template {
    containers {
      image = "${local.image_base}/gateway:${var.image_tag}"
      env   = local.common_env
      resources { limits = { cpu = "1", memory = "256Mi" } }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_api" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Runtime SA (Cloud SQL client needed) ───────────────────────
resource "google_service_account" "runtime" {
  account_id   = "ai-harness-runtime"
  display_name = "AI Harness runtime"
}

resource "google_project_iam_member" "run_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "run_invoker_sa" {
  project = var.project_id
  role    = "roles/run.services.get"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}
