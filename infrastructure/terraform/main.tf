locals {
  s3_prefix   = var.s3_prefix != "" ? var.s3_prefix : var.app_name
  dns_enabled = var.dns_zone_name != ""
  subdomain   = var.subdomain != "" ? var.subdomain : "${var.app_name}.${var.dns_zone_name}"

  events_readonly       = var.events_bootstrap_readonly_prefix != ""
  s3_events_prefix      = local.events_readonly ? var.events_bootstrap_readonly_prefix : "${local.s3_prefix}/events"
  s3_letsencrypt_prefix = "${local.s3_prefix}/letsencrypt"

  repo_url = var.repo_url != "" ? var.repo_url : "https://github.com/${var.github_owner}/${var.app_name}.git"

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    app_name         = var.app_name
    app_env          = var.app_env
    dns_enabled      = local.dns_enabled
    domain           = local.subdomain
    letsencrypt_s3   = "s3://${var.s3_bucket}/${local.s3_letsencrypt_prefix}"
    certbot_email    = var.certbot_email
    repo_url         = local.repo_url
    s3_bucket        = var.s3_bucket
    s3_events_prefix = "${local.s3_events_prefix}/"
    s3_readonly      = local.events_readonly
    region           = var.region
    secrets_path     = var.secrets_path
  })
}
