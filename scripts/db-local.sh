#!/usr/bin/env bash
# Local Postgres (PostgreSQL 16, D-12) for development and tests. Image pinned in docs/VERSIONS.md.
#
#   dev    container sotto-postgres on 127.0.0.1:56432 with volume sotto-pgdata. Its credentials live
#          only in the git ignored .env.local files (DATABASE_URL); this script never reads them.
#   test   container sotto-postgres-test on 127.0.0.1:56433: trust authentication on the loopback
#          interface only, data in memory (tmpfs), fsync off, removed by test-down. It holds no data
#          worth protecting: each test file creates and drops its own database in it
#          (packages/db/src/testing.ts). Used by pnpm test and scripts/ci-local.sh.
#
# Usage: scripts/db-local.sh up | down | status | test-up | test-down
set -euo pipefail

IMAGE="postgres:16.15@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54"
DEV_CONTAINER="sotto-postgres"
DEV_USER="sotto"
TEST_CONTAINER="sotto-postgres-test"
TEST_PORT="56433"

exists() { docker container inspect "$1" >/dev/null 2>&1; }
running() { [[ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }

wait_ready() {
  local container="$1" user="$2"
  # TCP inside the container: the temporary server of the image's first start listens only on the
  # Unix socket, so this succeeds only once the real server accepts connections.
  for _ in $(seq 1 120); do
    if docker exec "$container" pg_isready -q -h 127.0.0.1 -p 5432 -U "$user" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "error: $container did not become ready" >&2
  return 1
}

cmd_up() {
  if ! exists "$DEV_CONTAINER"; then
    echo "error: container $DEV_CONTAINER does not exist. Create it once with the command in" >&2
    echo "docs/VERSIONS.md (Local Postgres container), using the password of DATABASE_URL:" >&2
    echo "  docker volume create sotto-pgdata" >&2
    echo "  docker run -d --name $DEV_CONTAINER --restart unless-stopped -e POSTGRES_USER=sotto -e POSTGRES_DB=sotto \\" >&2
    echo "    -e POSTGRES_PASSWORD=<password> -p 127.0.0.1:56432:5432 -v sotto-pgdata:/var/lib/postgresql/data $IMAGE" >&2
    exit 1
  fi
  running "$DEV_CONTAINER" || docker start "$DEV_CONTAINER" >/dev/null
  wait_ready "$DEV_CONTAINER" "$DEV_USER"
  echo "dev database ready on 127.0.0.1:56432 (credentials in the .env.local files)"
}

cmd_down() {
  if running "$DEV_CONTAINER"; then docker stop "$DEV_CONTAINER" >/dev/null; fi
  echo "dev database stopped"
}

cmd_test_up() {
  if ! running "$TEST_CONTAINER"; then
    exists "$TEST_CONTAINER" && docker rm -f "$TEST_CONTAINER" >/dev/null
    docker run -d --rm --name "$TEST_CONTAINER" \
      -e POSTGRES_HOST_AUTH_METHOD=trust \
      -p "127.0.0.1:$TEST_PORT:5432" \
      --tmpfs /var/lib/postgresql/data:rw \
      "$IMAGE" -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null
  fi
  wait_ready "$TEST_CONTAINER" postgres
  echo "test database server ready: postgresql://postgres@127.0.0.1:$TEST_PORT/postgres"
}

cmd_test_down() {
  if exists "$TEST_CONTAINER"; then docker rm -f "$TEST_CONTAINER" >/dev/null; fi
  echo "test database server removed"
}

cmd_status() {
  local c
  for c in "$DEV_CONTAINER" "$TEST_CONTAINER"; do
    if exists "$c"; then
      echo "$c: $(docker container inspect -f '{{.State.Status}}' "$c")"
    else
      echo "$c: absent"
    fi
  done
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  test-up) cmd_test_up ;;
  test-down) cmd_test_down ;;
  *)
    echo "usage: scripts/db-local.sh up | down | status | test-up | test-down" >&2
    exit 2
    ;;
esac
