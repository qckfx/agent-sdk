#!/bin/bash
# binary-replace.sh - A fast, reliable binary replacement utility
# Usage: binary-replace.sh <original_file> <search_file> <replace_file> <output_file>
#
# This script properly handles special characters and newlines during replacement

set -e

# Check arguments
if [ "$#" -ne 4 ]; then
  echo "ERROR: Wrong number of arguments"
  echo "Usage: $(basename "$0") <original_file> <search_file> <replace_file> <output_file>"
  exit 1
fi

ORIGINAL_FILE="$1"
SEARCH_FILE="$2"
REPLACE_FILE="$3"
OUTPUT_FILE="$4"
TEMP_DIR=$(dirname "$OUTPUT_FILE")

# Ensure all input files exist
if [ ! -f "$ORIGINAL_FILE" ]; then
  echo "ERROR: Original file not found: $ORIGINAL_FILE"
  exit 1
fi

if [ ! -f "$SEARCH_FILE" ]; then
  echo "ERROR: Search pattern file not found: $SEARCH_FILE"
  exit 1
fi

if [ ! -f "$REPLACE_FILE" ]; then
  echo "ERROR: Replace content file not found: $REPLACE_FILE"
  exit 1
fi

# Create temporary files for our work
PREFIX_FILE="$TEMP_DIR/prefix.bin"
SUFFIX_FILE="$TEMP_DIR/suffix.bin"

# Get file sizes for reporting
ORIG_SIZE=$(wc -c < "$ORIGINAL_FILE")
SEARCH_SIZE=$(wc -c < "$SEARCH_FILE")
REPLACE_SIZE=$(wc -c < "$REPLACE_FILE")

# Convert to hex for pattern matching
xxd -p "$ORIGINAL_FILE" > "$TEMP_DIR/original.hex"
xxd -p "$SEARCH_FILE" > "$TEMP_DIR/search.hex"

# Read hex content without newlines (more reliable)
FILE_HEX=$(tr -d '\n' < "$TEMP_DIR/original.hex")
SEARCH_HEX=$(tr -d '\n' < "$TEMP_DIR/search.hex")

# Find the pattern in the hex representation
SEARCH_HEX_LEN=${#SEARCH_HEX}
HEX_POS=$(awk -v a="$FILE_HEX" -v b="$SEARCH_HEX" 'BEGIN{print index(a,b)}')

# If not found, exit with error
if [ "$HEX_POS" = "0" ]; then
  echo "ERROR: Pattern not found in hex representation"
  # Try to provide useful debugging info
  echo "Search content:"
  cat "$SEARCH_FILE"
  echo
  
  # Clean up temporary files
  rm -f "$TEMP_DIR/original.hex" "$TEMP_DIR/search.hex"
  exit 2
fi

# Calculate byte position (hex_pos is character position in hex dump)
BYTE_POS=$(((HEX_POS / 2) - 1))
if [ $((HEX_POS % 2)) -ne 0 ]; then
  echo "INFO: Hex position $HEX_POS is not aligned to byte boundary"
  # Adjust for alignment
  BYTE_POS=$((BYTE_POS + 1))
fi

# Calculate byte length of search pattern
BYTE_LEN=$((SEARCH_HEX_LEN / 2))

echo "Found pattern at byte offset $BYTE_POS"
echo "Pattern length: $BYTE_LEN bytes"

# OPTIMIZATION: Check for multiple occurrences with efficient string operations
# Remove the matching portion and see if the pattern still exists
TEMP_HEX="${FILE_HEX:0:$HEX_POS}${FILE_HEX:$((HEX_POS + SEARCH_HEX_LEN))}"
SECOND_POS=$(awk -v a="$TEMP_HEX" -v b="$SEARCH_HEX" 'BEGIN{print index(a,b)}')

if [ "$SECOND_POS" != "0" ]; then
  echo "ERROR: Multiple matches found. Please make the search pattern more specific."
  # Clean up temporary files
  rm -f "$TEMP_DIR/original.hex" "$TEMP_DIR/search.hex"
  exit 3
fi

# Extract the prefix (bytes before the match)
dd if="$ORIGINAL_FILE" of="$PREFIX_FILE" bs=1 count=$BYTE_POS 2>/dev/null
echo "Prefix size: $(wc -c < $PREFIX_FILE) bytes"

# Extract the suffix (bytes after the match)
dd if="$ORIGINAL_FILE" of="$SUFFIX_FILE" bs=1 skip=$((BYTE_POS + BYTE_LEN)) 2>/dev/null
echo "Suffix size: $(wc -c < $SUFFIX_FILE) bytes"

# Create the new file by concatenating the parts
cat "$PREFIX_FILE" "$REPLACE_FILE" "$SUFFIX_FILE" > "$OUTPUT_FILE"
NEW_SIZE=$(wc -c < "$OUTPUT_FILE")
echo "New file size: $NEW_SIZE bytes"

# Output sizes for verification
PREFIX_SIZE=$(wc -c < "$PREFIX_FILE")
SUFFIX_SIZE=$(wc -c < "$SUFFIX_FILE")
echo "SIZES: orig=$ORIG_SIZE bytes, prefix=$PREFIX_SIZE bytes, pattern=$SEARCH_SIZE bytes, replace=$REPLACE_SIZE bytes, suffix=$SUFFIX_SIZE bytes, new=$NEW_SIZE bytes"

# Clean up all temporary files
rm -f "$TEMP_DIR/original.hex" "$TEMP_DIR/search.hex" "$PREFIX_FILE" "$SUFFIX_FILE"

echo "SUCCESS: Replacement complete"
exit 0