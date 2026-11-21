import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { Emit, Handler } from "./decorations";
import { BulletWidget, CheckboxWidget, RuleWidget } from "./widgets";

// A marker plus the single space that follows it on the same line.
function markerEnd(state: EditorState, to: number): number {
  return state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
}

function atx(level: number): Handler {
  return (node, state, emit) => {
    emit.line(`cm-ld-h${level}`, node.from);
    for (const m of node.node.getChildren("HeaderMark")) {
      emit.hide(m.from, markerEnd(state, m.to));
    }
  };
}

function setext(level: number): Handler {
  return (node, state, emit) => {
    const mark = node.node.getChild("HeaderMark");
    const lastText = mark ? mark.from - 1 : node.to;
    const doc = state.doc;
    for (let l = doc.lineAt(node.from); ; l = doc.line(l.number + 1)) {
      emit.line(`cm-ld-h${level}`, l.from);
      if (l.to >= lastText || l.number >= doc.lines) break;
    }
    if (mark) emit.hide(mark.from, mark.to);
  };
}

function quoteDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let n: SyntaxNode | null = node; n; n = n.parent) if (n.name === "Blockquote") depth++;
  return depth;
}

function eachLine(state: EditorState, from: number, to: number, fn: (lineFrom: number) => void) {
  const doc = state.doc;
  for (let l = doc.lineAt(from); ; l = doc.line(l.number + 1)) {
    fn(l.from);
    if (l.to >= to || l.number >= doc.lines) break;
  }
}

function codeLines(cls: string, node: { from: number; to: number }, state: EditorState, emit: Emit) {
  eachLine(state, node.from, node.to, (pos) => emit.line(cls, pos));
}

const fenced: Handler = (node, state, emit) => {
  codeLines("cm-ld-codeblock", node, state, emit);
  const marks = node.node.getChildren("CodeMark");
  const info = node.node.getChild("CodeInfo");
  const open = marks[0];
  const close = marks.length > 1 ? marks[marks.length - 1] : null;
  const hidden = !emit.revealed(node.from, node.to);
  const fence = (pos: number, from: number, to: number) => {
    emit.line("cm-ld-fence", pos);
    if (hidden) {
      emit.line("cm-ld-fence-hidden", pos);
      emit.hide(from, to);
    }
  };
  if (open) fence(open.from, open.from, info && info.from >= open.to ? info.to : open.to);
  if (close) fence(close.from, close.from, close.to);
  return false;
};

export const blockHandlers: Record<string, Handler> = {
  ATXHeading1: atx(1),
  ATXHeading2: atx(2),
  ATXHeading3: atx(3),
  ATXHeading4: atx(4),
  ATXHeading5: atx(5),
  ATXHeading6: atx(6),
  SetextHeading1: setext(1),
  SetextHeading2: setext(2),
  Blockquote(node, state, emit) {
    const depth = quoteDepth(node.node);
    const cls = depth === 1 ? "cm-ld-quote" : `cm-ld-quote-${depth}`;
    eachLine(state, node.from, node.to, (pos) => emit.line(cls, pos));
  },
  QuoteMark(node, state, emit) {
    emit.hide(node.from, markerEnd(state, node.to));
  },
  ListMark(node, _state, emit) {
    const list = node.node.parent?.parent;
    if (list?.name !== "BulletList") return;
    emit.widget(new BulletWidget(), node.from, node.to);
  },
  TaskMarker(node, state, emit) {
    const pos = node.from + 1;
    const checked = state.doc.sliceString(pos, pos + 1).toLowerCase() === "x";
    emit.widget(new CheckboxWidget(checked, pos), node.from, node.to);
  },
  HorizontalRule(node, _state, emit) {
    emit.widget(new RuleWidget(), node.from, node.to);
  },
  FencedCode: fenced,
  CodeBlock(node, state, emit) {
    codeLines("cm-ld-codeblock", node, state, emit);
    return false;
  },
};
