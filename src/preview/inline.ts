import type { EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import type { Emit, Handler } from "./decorations";
import { gridTableOf, imageAlt } from "./images";
import { linkTarget } from "./links";
import { rawTable } from "./table-model";
import { ImageChipWidget } from "./widgets";

function styled(cls: string, markName: string): Handler {
  return (node, _state, emit) => {
    emit.mark(cls, node.from, node.to);
    for (const m of node.node.getChildren(markName)) emit.hide(m.from, m.to);
  };
}

function link(node: SyntaxNodeRef, state: EditorState, emit: Emit): void {
  if (linkTarget(state, node.node) === null) return;
  const marks = node.node.getChildren("LinkMark");
  const open = marks[0];
  const close = marks[1];
  if (!open || !close) return;
  emit.mark("cm-ld-link", open.to, close.from);
  emit.hide(open.from, open.to);
  emit.hide(close.from, node.to);
}

function autolink(node: SyntaxNodeRef, _state: unknown, emit: Emit): void {
  const marks = node.node.getChildren("LinkMark");
  const open = marks[0];
  const close = marks[marks.length - 1];
  if (!open || !close || open === close) return;
  emit.mark("cm-ld-link", open.to, close.from);
  emit.hide(open.from, open.to);
  emit.hide(close.from, close.to);
}

// The image itself is a block widget from imageField; here only its syntax is hidden.
// In a grid-table cell it becomes a chip instead (a table shown raw keeps its text).
function image(node: SyntaxNodeRef, state: EditorState, emit: Emit): boolean {
  // No destination: plain text, like a link without one (inline styling inside still applies).
  if (linkTarget(state, node.node) === null) return true;
  const table = gridTableOf(node.node);
  if (!table) emit.hide(node.from, node.to);
  else if (state.field(rawTable, false) !== table.from) {
    emit.widget(new ImageChipWidget(imageAlt(state, node.node)), node.from, node.to);
  }
  return false;
}

const URL_CONTAINERS = new Set(["Link", "Image", "Autolink", "LinkReference"]);

export const inlineHandlers: Record<string, Handler> = {
  StrongEmphasis: styled("cm-ld-strong", "EmphasisMark"),
  Emphasis: styled("cm-ld-em", "EmphasisMark"),
  Strikethrough: styled("cm-ld-strike", "StrikethroughMark"),
  InlineCode(node, state, emit) {
    styled("cm-ld-code", "CodeMark")(node, state, emit);
    return false;
  },
  Link: link,
  Autolink: autolink,
  Image: image,
  URL(node, _state, emit) {
    const parent = node.node.parent;
    if (parent && URL_CONTAINERS.has(parent.name)) return;
    emit.mark("cm-ld-link", node.from, node.to);
  },
};
