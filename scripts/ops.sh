#!/usr/bin/env bash
# Runs an operator command from a checkout of the operations repository, which is not public:
#   scripts/ops.sh <command> [args...]
# The checkout is $SOTTO_OPS, or a folder named sotto-ops beside this repository's shared copy.
set -euo pipefail
ops="${SOTTO_OPS:-$(cd "$(git rev-parse --git-common-dir)/../.." && pwd)/sotto-ops}"
command="${1:?usage: scripts/ops.sh <command> [args...]}"
shift
[ -x "$ops/bin/$command" ] || { echo "no operator command $command in $ops (set SOTTO_OPS)" >&2; exit 1; }
exec "$ops/bin/$command" "$@"
