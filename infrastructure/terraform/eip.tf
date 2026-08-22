resource "aws_eip" "app" {
  instance = aws_instance.app.id
}
