/** Parses one line of newline-delimited JSON; returns null on malformed/partial input rather than throwing. */
export function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
