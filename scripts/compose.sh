#!/usr/bin/env sh
# Runs `docker compose` when Docker is available, otherwise `podman compose`.
set -e

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  exec docker compose "$@"
elif command -v podman >/dev/null 2>&1; then
  exec podman compose "$@"
else
  echo "Neither Docker nor Podman is available. Install one of them first." >&2
  exit 1
fi
