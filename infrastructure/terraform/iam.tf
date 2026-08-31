resource "aws_iam_role" "app" {
  name = var.app_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_instance_profile" "app" {
  name = var.app_name
  role = aws_iam_role.app.name
}

data "aws_iam_policy_document" "app" {
  # Read/write this app's own certs under its S3 prefix.
  statement {
    sid       = "CertObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.s3_bucket}/${local.s3_letsencrypt_prefix}/*"]
  }

  # The event log: read/write normally, read-only when bootstrapping from
  # another environment's prefix (so QA can seed from prod but never write to it).
  statement {
    sid       = "EventObjects"
    actions   = local.events_readonly ? ["s3:GetObject"] : ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.s3_bucket}/${local.s3_events_prefix}/*"]
  }

  statement {
    sid       = "AppObjectsList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.s3_bucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.s3_letsencrypt_prefix}/*", "${local.s3_events_prefix}/*"]
    }
  }

  # Login secrets fetched at boot (Google login), shared account-wide via secrets_path.
  statement {
    sid       = "SharedSecrets"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.secrets_path}/*"]
  }

  # certbot DNS-01 validation — only when this app manages DNS.
  dynamic "statement" {
    for_each = local.dns_enabled ? [1] : []
    content {
      sid       = "CertbotRoute53Read"
      actions   = ["route53:ListHostedZones", "route53:GetChange"]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = local.dns_enabled ? [1] : []
    content {
      sid       = "CertbotRoute53Write"
      actions   = ["route53:ChangeResourceRecordSets"]
      resources = ["arn:aws:route53:::hostedzone/${data.aws_route53_zone.parent[0].zone_id}"]
    }
  }
}

resource "aws_iam_role_policy" "app" {
  name   = var.app_name
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}
