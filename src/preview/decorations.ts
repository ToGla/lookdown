import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range as CmRange } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { Decoration, type DecorationSet, type WidgetType } from "@codemirror/view";
import { blockHandlers } from "./blocks";
import { inlineHandlers } from "./inline";
import { tableHandlers } from "./tables";
import { isRevealed, revealedRanges } from "./reveal";

export type Emit = {
  hide(from: number, to: number): void;
  /** Like hide, but ignores reveal (table chrome stays hidden). */
  conceal(from: number, to: number): void;
  /** A zero-length widget at pos. */
  point(w: WidgetType, pos: number): void;
  mark(cls: string, from: number, to: number): void;
  line(cls: string, pos: number): void;
  widget(w: WidgetType, from: number, to: number): void;
  revealed(from: number, to: number): boolean;
  /** The range being built; handlers clamp per-line output to it. */
  range: { from: number; to: number };
};

export type Handler = (node: SyntaxNodeRef, state: EditorState, emit: Emit) => boolean | void;

const handlers: Record<string, Handler> = { ...inlineHandlers, ...blockHandlers, ...tableHandlers };

// Splits [from, to) into per-line pieces; line breaks are never covered.
function lineSegments(state: EditorState, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    const end = Math.min(line.to, to);
    if (end > pos) out.push([pos, end]);
    if (line.to >= to) break;
    pos = line.to + 1;
  }
  return out;
}

export function buildDecorations(state: EditorState, from: number, to: number): DecorationSet {
  const ranges = revealedRanges(state);
  const out: CmRange<Decoration>[] = [];
  const revealed = (f: number, t: number) => isRevealed(ranges, f, t);
  const emit: Emit = {
    hide(f, t) {
      if (f >= t || revealed(f, t)) return;
      for (const [a, b] of lineSegments(state, f, t)) {
        out.push(Decoration.replace({ ld: "hide" }).range(a, b));
      }
    },
    conceal(f, t) {
      if (f >= t) return;
      for (const [a, b] of lineSegments(state, f, t)) {
        out.push(Decoration.replace({ ld: "hide" }).range(a, b));
      }
    },
    point(w, pos) {
      out.push(Decoration.widget({ widget: w, side: 1, ld: "widget" }).range(pos));
    },
    mark(cls, f, t) {
      if (f < t) out.push(Decoration.mark({ class: cls, ld: "mark" }).range(f, t));
    },
    line(cls, pos) {
      const l = state.doc.lineAt(pos).from;
      out.push(Decoration.line({ class: cls, ld: "line" }).range(l));
    },
    widget(w, f, t) {
      if (f >= t || revealed(f, t)) return;
      // A widget cannot span a line break: it takes the first line, the rest is hidden.
      const [first, ...rest] = lineSegments(state, f, t);
      if (!first) return;
      out.push(Decoration.replace({ widget: w, ld: "widget" }).range(first[0], first[1]));
      for (const [a, b] of rest) out.push(Decoration.replace({ ld: "hide" }).range(a, b));
    },
    revealed,
    range: { from, to },
  };
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const h = handlers[node.name];
      if (h && h(node, state, emit) === false) return false;
    },
  });
  return Decoration.set(out, true);
}
