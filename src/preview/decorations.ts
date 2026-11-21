import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range as CmRange } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { Decoration, type DecorationSet, type WidgetType } from "@codemirror/view";
import { blockHandlers } from "./blocks";
import { inlineHandlers } from "./inline";
import { isRevealed, revealedRanges } from "./reveal";

export type Emit = {
  hide(from: number, to: number): void;
  mark(cls: string, from: number, to: number): void;
  line(cls: string, pos: number): void;
  widget(w: WidgetType, from: number, to: number): void;
  revealed(from: number, to: number): boolean;
};

export type Handler = (node: SyntaxNodeRef, state: EditorState, emit: Emit) => boolean | void;

const handlers: Record<string, Handler> = { ...inlineHandlers, ...blockHandlers };

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
