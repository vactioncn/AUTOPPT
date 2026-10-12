#!/bin/sh
set -eu
deployment_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec docker compose \
  -p "${AUTOPPT_COMPOSE_PROJECT:-autoppt-web}" \
  --project-directory "$deployment_root/deploy" \
  --env-file "$deployment_root/deploy/.env" \
  -f "$deployment_root/deploy/compose.yaml" \
  -f "$deployment_root/deploy/compose.speech.yaml" \
  -f "$deployment_root/deploy/compose.music.yaml" \
  "$@"
