import { createInterface } from 'node:readline';
import TextBuffer from './textBuffer.js';

/**
 * Determines if a chunk should be treated as a paste based on size
 * @param chunk - The incoming data chunk
 * @returns True if chunk should be treated as paste
 */
function isPaste(chunk: string): boolean {
  return chunk.length > 10;
}

/**
 * Expands paste tokens in text with their corresponding paste block content
 * @param text - Text containing paste tokens
 * @param pastedBlocks - Array of pasted content blocks
 * @returns Text with paste tokens replaced by actual content
 */
function expandPasteTokens(text: string, pastedBlocks: string[]): string {
  let finalText = text;
  pastedBlocks.forEach((content, index) => {
    const token = `\u0000PASTE#${index + 1}\u0000`;
    finalText = finalText.replace(token, content);
  });
  return finalText;
}

/**
 * Presents an interactive multiline prompt to the user.
 * For TTY: manages buffer state, handles backspace, newline continuation with '\' + Enter,
 * submission on Enter, and paste capture with placeholder tokens.
 * For non-TTY: falls back to readline interface reading until EOF.
 * @param question - The question/message to display to the user
 * @returns Promise resolving to the user's input with paste tokens expanded
 */
export async function interactivePrompt(question: string): Promise<string> {
  console.log(question);

  return new Promise<string>(resolve => {
    if (!process.stdin.isTTY) {
      handleNonTTYInput(resolve);
      return;
    }

    handleTTYInput(resolve);
  });
}

/**
 * Handles input for non-TTY environments using readline
 * @param resolve - Promise resolve function
 */
function handleNonTTYInput(resolve: (value: string) => void): void {
  const lines: string[] = [];
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', (line: string) => lines.push(line));
  rl.on('close', () => resolve(lines.join('\n').replace(/\n$/, '')));
}

/**
 * Handles input for TTY environments with raw mode and advanced features
 * @param resolve - Promise resolve function
 */
function handleTTYInput(resolve: (value: string) => void): void {
  const { stdin: input, stdout: output } = process;

  input.setRawMode(true);

  const textBuffer = new TextBuffer();
  const pastedBlocks: string[] = [];

  let previousLineCount = 0;
  let pasteBuffer = '';
  let pasteTimeout: NodeJS.Timeout | null = null;

  // --- helper: wrap lines to account for terminal width ---
  /**
   *
   * @param line
   * @param width
   */
  function wrapLine(line: string, width: number): string[] {
    if (width <= 0) return [line];
    const segments: string[] = [];
    for (let start = 0; start < line.length; start += width) {
      segments.push(line.slice(start, start + width));
    }
    // preserve empty line
    return segments.length ? segments : [''];
  }

  /**
   *
   * @param text
   * @param width
   */
  function getWrappedLines(text: string, width: number): string[] {
    return text.split('\n').flatMap(l => wrapLine(l, width));
  }

  /**
   * Flushes accumulated paste buffer as a single paste block
   */
  const flushPasteBuffer = (): void => {
    if (pasteBuffer) {
      let pasteContent = pasteBuffer;
      if (pasteContent.endsWith('\n')) {
        pasteContent = pasteContent.slice(0, -1);
      }

      const pasteIndex = pastedBlocks.length + 1;
      pastedBlocks.push(pasteContent);
      const token = `\u0000PASTE#${pasteIndex}\u0000`;
      textBuffer.insertStr(token);
      pasteBuffer = '';
      renderDisplay();
    }
  };

  /**
   * Cleanup function to restore normal terminal mode
   */
  const cleanup = (): void => {
    if (pasteTimeout) {
      clearTimeout(pasteTimeout);
    }
    input.setRawMode(false);
    input.removeAllListeners('data');
    output.write('\n');
    output.write('\x1b[K');
  };

  const renderDisplay = (): void => {
    let displayText = textBuffer.getText();

    // Collapse pasted blocks to placeholders
    pastedBlocks.forEach((content, index) => {
      const token = `\u0000PASTE#${index + 1}\u0000`;
      const lineCount = content.split(/(?:\r\n|\r|\n)/).length;
      displayText = displayText.replace(token, `[Paste #${index + 1} +${lineCount} lines]`);
    });

    const termWidth = output.columns ?? process.stdout.columns ?? 80;
    const lines = getWrappedLines(displayText, termWidth);
    const lineCount = lines.length;

    // ------------------------------------------------------------
    // Helper to translate the TextBuffer cursor position (row/col)
    // to a rendered row/col after wrapping so we can move the
    // terminal caret accordingly.
    // ------------------------------------------------------------
    /**
     *
     * @param originalOffset
     */
    function computeDisplayOffset(originalOffset: number): number {
      const originalText = textBuffer.getText();
      let displayOffset = originalOffset;

      // Find all paste tokens and their positions in the original text
      pastedBlocks.forEach((content, index) => {
        const token = `\u0000PASTE#${index + 1}\u0000`;
        const tokenStart = originalText.indexOf(token);

        // Only adjust for tokens that appear before the cursor position
        if (tokenStart !== -1 && tokenStart < originalOffset) {
          const lineCount = content.split(/(?:\r\n|\r|\n)/).length;
          const placeholder = `[Paste #${index + 1} +${lineCount} lines]`;
          const tokenLength = token.length;
          const placeholderLength = placeholder.length;

          // Add the difference in length (placeholder is typically longer than token)
          displayOffset += placeholderLength - tokenLength;
        }
      });

      return displayOffset;
    }

    /**
     *
     */
    function getCursorRenderPosition(): { row: number; col: number } {
      // 1. Calculate the character offset of the caret in the *original*
      //    TextBuffer (before placeholder expansion).
      const [cursorRow, cursorCol] = textBuffer.getCursor();
      const originalLines = textBuffer.getLines();
      let originalOffset = 0;
      for (let r = 0; r < cursorRow; r++) {
        originalOffset += originalLines[r].length + 1; // +1 for the newline that was split by getLines()
      }
      originalOffset += cursorCol;

      // 2. Compute the display offset accounting for paste token/placeholder length differences
      const displayOffset = computeDisplayOffset(originalOffset);

      // 3. Walk through the *display* text (after placeholder expansion)
      //    keeping track of wrapping so we can translate the offset -> row/col.
      let row = 0;
      let col = 0;
      for (let i = 0; i < Math.min(displayOffset, displayText.length); i++) {
        const ch = displayText[i];
        if (ch === '\n') {
          row++;
          col = 0;
          continue;
        }

        col++;
        if (col >= termWidth) {
          row++;
          col = 0;
        }
      }
      return { row, col };
    }

    // Hide the hardware cursor while we redraw to prevent flicker
    output.write('\x1b[?25l');

    // Clear previous content
    if (previousLineCount > 0) {
      // Move to start of current line
      output.write('\r');
      for (let i = 0; i < previousLineCount; i++) {
        output.write('\x1b[2K'); // clear the entire line
        if (i < previousLineCount - 1) {
          output.write('\x1b[1A'); // move cursor up one line
        }
      }
    }

    // Write the buffer content
    output.write(lines.join('\n'));

    // Calculate caret position and move cursor there
    const { row: caretRow, col: caretCol } = getCursorRenderPosition();
    const linesAboveCaret = lineCount - caretRow - 1;

    if (linesAboveCaret > 0) {
      output.write(`\x1b[${linesAboveCaret}A`); // move up N lines
    }

    // Return to column 0 of the line then move right caretCol columns
    output.write('\r');
    if (caretCol > 0) {
      output.write(`\x1b[${caretCol}C`); // move right N columns
    }

    // Show the hardware cursor again
    output.write('\x1b[?25h');

    previousLineCount = lineCount;
  };

  input.on('data', (chunk: Buffer) => {
    const data = chunk.toString();

    if (isPaste(data)) {
      // Accumulate paste chunks
      pasteBuffer += data;

      // Clear any existing timeout
      if (pasteTimeout) {
        clearTimeout(pasteTimeout);
      }

      // Set a short timeout to flush the paste buffer
      pasteTimeout = setTimeout(flushPasteBuffer, 50);
      return;
    }

    // If we have accumulated paste data, flush it first
    if (pasteBuffer) {
      if (pasteTimeout) {
        clearTimeout(pasteTimeout);
        pasteTimeout = null;
      }
      flushPasteBuffer();
    }

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const charCode = char.charCodeAt(0);

      if (charCode === 3) {
        cleanup();
        process.exit(0);
      } else if (charCode === 4) {
        cleanup();
        resolve(expandPasteTokens(textBuffer.getText(), pastedBlocks).trim());
        return;
      } else if (charCode === 27 && i + 2 < data.length && data[i + 1] === '[') {
        // Handle ANSI escape sequences for arrow keys
        const escapeSequence = data.slice(i, i + 3);
        if (escapeSequence === '\x1b[A') {
          textBuffer.move('up');
          renderDisplay();
          i += 2; // Skip the processed bytes
        } else if (escapeSequence === '\x1b[B') {
          textBuffer.move('down');
          renderDisplay();
          i += 2; // Skip the processed bytes
        } else if (escapeSequence === '\x1b[C') {
          textBuffer.move('right');
          renderDisplay();
          i += 2; // Skip the processed bytes
        } else if (escapeSequence === '\x1b[D') {
          textBuffer.move('left');
          renderDisplay();
          i += 2; // Skip the processed bytes
        } else {
          // Unknown escape sequence, treat as regular character
          textBuffer.insert(char);
          renderDisplay();
        }
      } else if (charCode === 127 || charCode === 8) {
        textBuffer.backspace();
        renderDisplay();
      } else if (char === '\n' || char === '\r') {
        const currentText = textBuffer.getText();
        if (currentText.endsWith('\\')) {
          textBuffer.backspace();
          textBuffer.insertStr('\n');
          renderDisplay();
        } else {
          cleanup();
          resolve(expandPasteTokens(textBuffer.getText(), pastedBlocks).trim());
          return;
        }
      } else if (charCode >= 32 || char === '\t') {
        textBuffer.insert(char);
        renderDisplay();
      }
    }
  });

  renderDisplay();
}
