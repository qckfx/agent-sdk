#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# fix-docker-mapper.sh
# -----------------------------------------------------------------------------
# Convenience helper that makes sure the latest version of directory-mapper.sh
# that lives in this repository ends up inside the running sandbox container.
#
# In most cases you *should not* need this script anymore because the sandbox
# image is now published to a registry and the run-container helper will pull
# the freshest image automatically.  However, if you are iterating on
# directory-mapper.sh locally, running this script lets you copy the file into
# a running container without having to rebuild / push the full image.
# -----------------------------------------------------------------------------

set -euo pipefail

CONTAINER_NAME="qckfx-sandbox"

echo "[docker:fix] Looking for running container named $CONTAINER_NAME …"

if ! docker info > /dev/null 2>&1; then
  echo "Docker does not appear to be running – aborting." >&2
  exit 1
fi

CONTAINER_ID=$(docker ps -q --filter "name=$CONTAINER_NAME")

if [[ -z "$CONTAINER_ID" ]]; then
  echo "Container $CONTAINER_NAME is not running.  Start it first using run-container.sh or docker compose." >&2
  exit 1
fi

SCRIPT_SRC="$(dirname "$0")/directory-mapper.sh"
SCRIPT_DEST="/usr/local/bin/directory-mapper.sh"

echo "[docker:fix] Copying updated directory-mapper.sh into the container…"
docker cp "$SCRIPT_SRC" "$CONTAINER_ID:$SCRIPT_DEST"
docker exec "$CONTAINER_ID" chmod +x "$SCRIPT_DEST"
docker exec "$CONTAINER_ID" chown agent:agent "$SCRIPT_DEST"

echo "[docker:fix] Verifying inside the container:"
docker exec "$CONTAINER_ID" ls -la "$SCRIPT_DEST"

echo "[docker:fix] Done.  The sandbox container now has the latest directory-mapper.sh."
