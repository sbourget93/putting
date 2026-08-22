#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../infrastructure"
terraform apply -replace=module.app.aws_instance.app "$@"
