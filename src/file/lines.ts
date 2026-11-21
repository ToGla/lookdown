// Maps between a file's raw text (original line endings) and the normalized
// text CodeMirror holds (every line ending is "\n"). Saving rebuilds the raw
// text from CodeMirror's changes, copying untouched stretches verbatim, so
// line endings nobody edited stay exactly as they were.

import type { ChangeSet } from "@codemirror/state";

export type Eol = "\n" | "\r\n" | "\r";

export interface Base {
  /** The decoded file text, with its original line endings. */
  raw: string;
  /** Ending used for line breaks typed or pasted into the editor. */
  eol: Eol;
  /** Raw offset where each line starts. */
  lineStarts: number[];
  /** Normalized offset where each line starts. */
  normStarts: number[];
}

// Same line-break rule as CodeMirror's default.
const LINE_BREAK = /\r\n?|\n/g;

export function makeBase(raw: string): Base {
  const lineStarts = [0];
  const normStarts = [0];
  const counts = { "\n": 0, "\r\n": 0, "\r": 0 };
  for (const m of raw.matchAll(LINE_BREAK)) {
    const ending = m[0] as Eol;
    counts[ending]++;
    const end = m.index + ending.length;
    // The normalized line length equals its raw length without the ending.
    normStarts.push(normStarts[normStarts.length - 1] + (m.index - lineStarts[lineStarts.length - 1]) + 1);
    lineStarts.push(end);
  }
  let eol: Eol = "\n";
  if (counts["\r\n"] > counts[eol]) eol = "\r\n";
  if (counts["\r"] > counts[eol]) eol = "\r";
  return { raw, eol, lineStarts, normStarts };
}

export function normalized(base: Base): string {
  return base.raw.replace(LINE_BREAK, "\n");
}

/** Raw offset of a normalized offset. */
function toRaw(base: Base, pos: number): number {
  const starts = base.normStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return base.lineStarts[lo] + (pos - starts[lo]);
}

/** The raw text after applying `changes` (made against `normalized(base)`). */
export function rebuild(base: Base, changes: ChangeSet): string {
  let out = "";
  let pos = 0;
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out += base.raw.slice(toRaw(base, pos), toRaw(base, fromA));
    out += inserted.sliceString(0, inserted.length, base.eol);
    pos = toA;
  });
  return out + base.raw.slice(toRaw(base, pos));
}
