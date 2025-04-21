#!/bin/bash
# /docker/run-container.sh

# Default values
CONTAINER_NAME="qckfx-sandbox"
PROJECT_DIR=$(pwd)
WRITABLE_DIRS=""
NETWORK_MODE="none"

# Help text
function show_help {
  echo "Usage: run-container.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -n, --name NAME       Set container name (default: qckfx-sandbox)"
  echo "  -p, --project DIR     Set project directory to mount (default: current dir)"
  echo "  -w, --writable DIR    Additional directory to mount as writable (can be used multiple times)"
  echo "  --network MODE        Set network mode (none, host, bridge) (default: none)"
  echo "  -h, --help            Show this help message"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    -n|--name)
      CONTAINER_NAME="$2"
      shift 2
      ;;
    -p|--project)
      PROJECT_DIR="$2"
      shift 2
      ;;
    -w|--writable)
      WRITABLE_DIRS="$WRITABLE_DIRS -v $2:$2"
      shift 2
      ;;
    --network)
      NETWORK_MODE="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

# Check if Docker is installed and running
if ! docker info > /dev/null 2>&1; then
  echo "Error: Docker is not running or not installed."
  exit 1
fi

# Check if container already exists and is running
if docker ps -q --filter "name=$CONTAINER_NAME" | grep -q .; then
  echo "Container $CONTAINER_NAME is already running."
  
  # Configure git to trust workspace directory in case container was created before this fix
  docker exec $CONTAINER_NAME git config --global --add safe.directory /workspace
  exit 0
fi

# Check if container exists but is stopped
if docker ps -aq --filter "name=$CONTAINER_NAME" | grep -q .; then
  echo "Starting existing container $CONTAINER_NAME..."
  docker start $CONTAINER_NAME
  
  # Configure git to trust workspace directory in case container was created before this fix
  docker exec $CONTAINER_NAME git config --global --add safe.directory /workspace
  exit 0
fi

# Create and start a new container
echo "Creating new container $CONTAINER_NAME..."
docker run -d \
  --name $CONTAINER_NAME \
  --network $NETWORK_MODE \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --cpu-shares 512 \
  --memory 512m \
  -v "$PROJECT_DIR:/workspace:ro" \
  $WRITABLE_DIRS \
  -v "$CONTAINER_NAME-tmp:/workspace/tmp" \
  -w /workspace \
  $(dirname "$0")/../docker/agent-sandbox

echo "Container $CONTAINER_NAME started successfully."