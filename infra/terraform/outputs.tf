output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "gateway_url" { value = google_cloud_run_v2_service.gateway.uri }
output "redis_host" { value = google_redis_instance.cache.host; sensitive = true }
output "db_private_ip" { value = google_sql_database_instance.pg.private_ip_address; sensitive = true }
