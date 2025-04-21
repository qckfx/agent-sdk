#!/bin/bash
#
# Hyper-optimized Directory Mapper Script
# Generates a structured directory listing for AI context with maximum performance
#
# IMPORTANT: This script is used by both the local agent and Docker containers.
# When modifying this script, remember to rebuild Docker containers for changes
# to take effect. You can do this with:
#   docker-compose -f docker/docker-compose.yml build
#   docker-compose -f docker/docker-compose.yml up -d
#
# Usage: ./directory-mapper.sh [root_directory] [max_depth] [log_file]
#   - root_directory: The directory to map (defaults to current directory)
#   - max_depth: Maximum directory depth to include (defaults to 10)
#   - log_file: Optional path to save log output (defaults to no logging)
#

# Set -e to halt on errors, -u for undefined variables
set -eu

# Default values
ROOT_DIR="${1:-$(pwd)}"
MAX_DEPTH="${2:-10}"
LOG_FILE="${3:-}"
ROOT_DISPLAY_NAME="$ROOT_DIR"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
TEMP_OUTPUT=$(mktemp)

# Clean up temp files on exit
trap 'rm -f "$TEMP_OUTPUT"' EXIT INT TERM

# Change to root directory immediately
cd "$ROOT_DIR" || { echo "Failed to change to $ROOT_DIR"; exit 1; }

# Create output header
{
  echo '<context name="directoryStructure">Below is a snapshot of this project'"'"'s file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.'
  echo
  echo "- ${ROOT_DISPLAY_NAME}/"
} > "$TEMP_OUTPUT"

# Use git for listing if available (to respect .gitignore)
if [ -d ".git" ] && command -v git &>/dev/null; then
  # Get all files from git - much faster than using find
  ALL_FILES=$(git ls-files --cached --others --exclude-standard)
  
  # Top-level files - direct processing without multiple commands
  echo "$ALL_FILES" | grep -v "/" | sort | awk '{print "  - " $0}' >> "$TEMP_OUTPUT"
  
  # Process all directories in a single pass
  # Create a mapping of file paths to their directory components
  DIRS_MAP=$(mktemp)
  echo "$ALL_FILES" | grep "/" | sed 's#/[^/]*$##' | sort -u > "$DIRS_MAP"
  
  # Build a list of directories at each level
  LEVEL1=$(grep -v "/" "$DIRS_MAP" | sort -u)
  
  # Process level 1 directories 
  for dir in $LEVEL1; do
    echo "  - $dir/" >> "$TEMP_OUTPUT"
    
    # Get all files directly in this directory - single pattern match
    echo "$ALL_FILES" | grep "^$dir/[^/]*$" | sort | awk -F/ '{print "    - " $2}' >> "$TEMP_OUTPUT"
  done
  
  # Only process deeper levels if max_depth is greater than 1
  if [ "$MAX_DEPTH" -gt 1 ]; then
    # Level 2 directories
    LEVEL2=$(grep -E "^[^/]+/[^/]+$" "$DIRS_MAP" | sort -u)
    
    for dir in $LEVEL2; do
      # Get parent and current dir name
      parent=$(dirname "$dir")
      name=$(basename "$dir")
      echo "    - $name/" >> "$TEMP_OUTPUT"
      
      # Get files directly in this directory
      echo "$ALL_FILES" | grep "^$dir/[^/]*$" | sort | awk -F/ '{print "      - " $3}' >> "$TEMP_OUTPUT"
    done
  fi
  
  # Only process level 3 if max_depth is greater than 2
  if [ "$MAX_DEPTH" -gt 2 ]; then
    # Level 3 directories
    LEVEL3=$(grep -E "^[^/]+/[^/]+/[^/]+$" "$DIRS_MAP" | sort -u)
    
    for dir in $LEVEL3; do
      name=$(basename "$dir")
      # Get the parent directory to maintain tree structure
      parent=$(dirname "$dir")
      echo "      - $name/" >> "$TEMP_OUTPUT"
      
      # Get files directly in this directory
      echo "$ALL_FILES" | grep "^$dir/[^/]*$" | sort | awk -F/ '{print "        - " $4}' >> "$TEMP_OUTPUT"
    done
  fi
  
  # Process deeper levels only if needed
  if [ "$MAX_DEPTH" -gt 3 ]; then
    # For deeper levels, use simpler but effective approach
    for ((level=4; level<=MAX_DEPTH; level++)); do
      # Calculate indentation
      indent=$(printf '%*s' "$((level * 2))" '')
      
      # Build pattern to match paths at this exact depth
      pattern="^"
      for ((i=1; i<level; i++)); do
        pattern="${pattern}[^/]+/"
      done
      pattern="${pattern}[^/]+$"
      
      # Get directories at this depth
      dirs_at_level=$(grep -E "$pattern" "$DIRS_MAP" | sort -u)
      
      for dir in $dirs_at_level; do
        name=$(basename "$dir")
        echo "$indent- $name/" >> "$TEMP_OUTPUT"
        
        # Files directly in this directory - use fast pattern matching
        echo "$ALL_FILES" | grep "^$dir/[^/]*$" | awk -F/ '{print $NF}' | sort | awk -v indent="$indent" '{print indent "  - " $0}' >> "$TEMP_OUTPUT"
      done
    done
  fi
  
  # Clean up
  rm -f "$DIRS_MAP"
else
  # Not a git repo - use optimized find commands
  # SINGLE PASS: Get all files and directories in one go

  # Process top-level files
  find . -maxdepth 1 -type f | sort | sed 's|^\./||' | awk '{print "  - " $0}' >> "$TEMP_OUTPUT"
  
  # Process directories with a breadth-first approach
  # Build a list of all directories first to minimize file system calls
  DIRS_TEMP=$(mktemp)
  find . -type d -not -path "." | sort > "$DIRS_TEMP"
  
  # Process each directory level
  for level in $(seq 1 "$MAX_DEPTH"); do
    # Calculate indentation and depth
    indent=$(printf '%*s' "$((level * 2))" '')
    
    # Pattern to match directories at exactly this depth
    pattern="^\./$(printf '%.0s[^/]*/' $(seq 1 $level))$"
    
    # Get directories at this level
    grep -E "$pattern" "$DIRS_TEMP" | sed 's|^\./||' | while read -r dir; do
      dirname=$(basename "$dir")
      # Calculate proper indentation based on depth
      echo "$indent- $dirname/" >> "$TEMP_OUTPUT"
      
      # Get files in this directory in a single operation
      find "./$dir" -maxdepth 1 -type f | sed 's|.*/||' | sort | awk -v indent="$indent" '{print indent "  - " $0}' >> "$TEMP_OUTPUT"
    done
  done
  
  # Clean up
  rm -f "$DIRS_TEMP"
fi

# Add the closing tag
echo '</context>' >> "$TEMP_OUTPUT"

# Output to stdout
cat "$TEMP_OUTPUT"

# Handle logging if a log file was specified
if [ -n "$LOG_FILE" ]; then
  # Create log directory if it doesn't exist
  log_dir=$(dirname "$LOG_FILE")
  mkdir -p "$log_dir"
  
  # Copy rather than reprocess
  {
    echo "Directory Mapping generated on $TIMESTAMP"
    echo "Root directory: $ROOT_DIR"
    echo "Max depth: $MAX_DEPTH"
    echo "----------------------------------------"
    echo
    cat "$TEMP_OUTPUT"
    echo
    echo "Directory mapping completed on $TIMESTAMP"
    echo "Lines: $(wc -l < "$TEMP_OUTPUT")"
  } > "$LOG_FILE"
  
  echo "Log saved to: $LOG_FILE" >&2
fi