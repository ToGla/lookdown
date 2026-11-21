import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range as CmRange } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { Decoration, type DecorationSet, type WidgetType } from "@codemirror/view";
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

const handlers: Record<string, Handler> = { ...inlineHandlers };

export function buildDecorations(state: EditorState, from: number, to: number): DecorationSet {
  const ranges = revealedRanges(state);
  const out: CmRange<Decoration>[] = [];
  const revealed = (f: number, t: number) => isRevealed(ranges, f, t);
  const emit: Emit = {
    hide(f, t) {
      if (f < t && !revealed(f, t)) out.push(Decoration.replace({ ld: "hide" }).range(f, t));
    },
    mark(cls, f, t) {
      if (f < t) out.push(Decoration.mark({ class: cls, ld: "mark" }).range(f, t));
    },
    line(cls, pos) {
      const l = state.doc.lineAt(pos).from;
      out.push(Decoration.line({ class: cls, ld: "line" }).range(l));
    },
    widget(w, f, t) {
      if (!revealed(f, t)) out.push(Decoration.replace({ widget: w, ld: "widget" }).range(f, t));
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
