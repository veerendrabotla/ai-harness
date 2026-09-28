terraform {
  required_version = ">= 1.11.4"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Artifact Registry ──────────────────────────────────────────
resource "google_artifact_registry_repository" "images" {
  repository_id = "ai-harness"
  format        = "DOCKER"
  location      = var.region
}

# ── Cloud SQL (PostgreSQL 17) ──────────────────────────────────
resource "google_sql_database_instance" "pg" {
  name             = "ai-harness-pg"
  database_version = "POSTGRES_17"
  region           = var.region
  deletion_protection = true

  settings {
    tier              = var.db_tier
    availability_type = "REGIONAL"
    ip_configuration { ipv4_enabled = false }
    backup_configuration { enabled = true }
  }
}

resource "google_sql_database" "app" { name = "ai_harness"; instance = google_sql_database_instance.pg.name }
resource "google_sql_user" "app" {
  name     = "ai_harness"
  instance = google_sql_database_instance.pg.name
  password = var.db_password
}

# ── Memorystore (Redis 7.4) ────────────────────────────────────
resource "google_redis_instance" "cache" {
  name           = "ai-harness-redis"
  memory_size_gb = 1
  redis_version  = "REDIS_7_4"
  tier           = "STANDARD_HA"
  region         = var.region
}
