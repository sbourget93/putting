#!/usr/bin/env bash
# Replace the instance so user_data re-runs (fresh clone + rebuild). Push first.
set -euo pipefail
cd "$(dirname "$0")"
terraform apply -replace=module.app.aws_instance.app "$@"
