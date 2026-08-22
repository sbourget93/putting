resource "aws_route53_record" "app" {
  count = local.dns_enabled ? 1 : 0

  zone_id = data.aws_route53_zone.parent[0].zone_id
  name    = local.subdomain
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
