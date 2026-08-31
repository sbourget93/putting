#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../infrastructure"

case "${1:-}" in
  prod) WORKSPACE=default ;;
  qa)   WORKSPACE=qa ;;
  *)    echo "Usage: $(basename "$0") {prod|qa} [terraform args...]" >&2; exit 1 ;;
esac
shift

terraform workspace select "$WORKSPACE"
terraform destroy "$@"
