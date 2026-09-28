variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "db_tier" {
  type    = string
  default = "db-g1-small"
}
variable "db_password" {
  type      = string
  sensitive = true
}

variable "jwt_access_secret" {
  type      = string
  sensitive = true
}
variable "csrf_secret" {
  type      = string
  sensitive = true
}
variable "encryption_key" {
  type      = string
  sensitive = true
}
variable "bridge_internal_token" {
  type      = string
  sensitive = true
}
variable "frontend_origin" {
  type    = string
  default = "https://app.example.com"
}
variable "api_base_url" {
  type    = string
  default = "https://api.example.com"
}
variable "image_tag" {
  type    = string
  default = "latest"
}

locals {
  db_host    = google_sql_database_instance.pg.private_ip_address
  redis_host = google_redis_instance.cache.host
  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "DATABASE_URL", value = "postgresql://ai_harness:${var.db_password}@${local.db_host}:5432/ai_harness?schema=public&connection_limit=10" },
    { name = "REDIS_URL", value = "redis://${local.redis_host}:6379" },
    { name = "JWT_ACCESS_SECRET", value = var.jwt_access_secret },
    { name = "CSRF_SECRET", value = var.csrf_secret },
    { name = "ENCRYPTION_KEY", value = var.encryption_key },
    { name = "BRIDGE_INTERNAL_TOKEN", value = var.bridge_internal_token },
    { name = "BRIDGE_GATEWAY_URL", value = "http://gateway:4010" },
  ]
  image_base = "${var.region}-docker.pkg.dev/${var.project_id}/ai-harness"
}
