const CONTROL_MAX = 32;
const DELETE_CODE = 127;

/**
 * One line of printable text, safe to splice into a single line status message. Backends emit
 * ANSI escapes, newlines and stray control bytes; a status line must survive all of them.
 */
export const flattenText = (text: string, maxLength: number): string =>
  [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < CONTROL_MAX || code === DELETE_CODE ? ' ' : char;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
