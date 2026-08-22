terraform {
  backend "s3" {
    bucket = "apps-743018003420-us-east-1-an"
    key    = "app-template/terraform/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"
}

module "app" {
  source   = "./terraform"
  app_name = "app-template"
}
