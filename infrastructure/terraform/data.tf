data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
}

data "aws_caller_identity" "current" {}

# Looked up only when DNS is enabled; referenced elsewhere as [0].
data "aws_route53_zone" "parent" {
  count = local.dns_enabled ? 1 : 0
  name  = var.dns_zone_name
}
