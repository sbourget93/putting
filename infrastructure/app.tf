terraform {
  backend "s3" {
    bucket = "apps-743018003420-us-east-1-an"
    key    = "putting/terraform/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"
}

locals {
  is_prod  = terraform.workspace == "default"
  app_name = local.is_prod ? "putting" : "putting-${terraform.workspace}"
}

module "app" {
  source                           = "./terraform"
  app_name                         = local.app_name
  repo_url                         = "https://github.com/sbourget93/putting.git"
  events_bootstrap_readonly_prefix = local.is_prod ? "" : "putting/events"
  secrets_path                     = local.is_prod ? "/shared" : "/shared-qa"
}
