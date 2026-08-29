variable "app_name" {
  description = "Short unique name for the app. Names every resource, the tag, the SSM parameter prefix, and the key-pair/PEM file. Must be a DNS-safe label."
  type        = string
}

variable "region" {
  description = "AWS region the app runs in."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type. Keep in the ARM (t4g) family so the arm64 AMI applies."
  type        = string
  default     = "t4g.nano"
}

variable "s3_bucket" {
  description = "Existing shared S3 bucket for the apps in this account/region (holds Terraform state, Let's Encrypt certs, and the event log). Each app is namespaced under s3_prefix."
  type        = string
  default     = "apps-743018003420-us-east-1-an"
}

variable "s3_prefix" {
  description = "Key prefix within s3_bucket for this app's objects (certs, events). Defaults to app_name."
  type        = string
  default     = ""
}

variable "dns_zone_name" {
  description = "Parent Route 53 hosted zone. Set empty to skip all DNS and the certbot IAM grants."
  type        = string
  default     = "stephengb.com"
}

variable "subdomain" {
  description = "Fully-qualified A record for the instance. Empty = inferred as <app_name>.<dns_zone_name>. Ignored when dns_zone_name is empty."
  type        = string
  default     = ""
}

variable "certbot_email" {
  description = "Email for Let's Encrypt notifications. Used by the cert-fetch step when DNS is managed; empty registers without an email."
  type        = string
  default     = ""
}

variable "github_owner" {
  description = "GitHub user or org that owns the app repos. Used to infer repo_url when it is unset."
  type        = string
  default     = "sbourget93"
}

variable "repo_url" {
  description = "HTTPS git URL the instance clones at boot to build and run the app (frontend + backend + gateway containers). Empty = inferred as https://github.com/<github_owner>/<app_name>.git."
  type        = string
  default     = ""
}

variable "secrets_path" {
  description = "SSM Parameter Store path prefix for the login secrets the instance reads at boot (google_client_id, admin_subs, session_secret). Account-level by default so it is shared across apps; no leading resource, no trailing slash."
  type        = string
  default     = "/shared"
}
