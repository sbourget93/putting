resource "tls_private_key" "app" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "app" {
  key_name   = var.app_name
  public_key = tls_private_key.app.public_key_openssh
}

# Written into the calling app's root dir (path.root), not this shared module.
resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.app.private_key_openssh
  filename        = "${path.root}/${var.app_name}.pem"
  file_permission = "0600"
}
