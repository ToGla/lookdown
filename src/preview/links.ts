import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const OPENABLE = /^(https?:|mailto:)/i;

export function isOpenableUrl(url: string): boolean {
  return OPENABLE.test(url);
}

function normalizeLabel(label: string): string {
  return label.replace(/^\[|\]$/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanUrl(raw: string): string {
  const t = raw.trim();
  return t.startsWith("<") && t.endsWith(">") ? t.slice(1, -1) : t;
}

function definitionUrl(state: EditorState, label: string): string | null {
  const want = normalizeLabel(label);
  let found: string | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (found !== null) return false;
      if (node.name !== "LinkReference") return;
      const l = node.node.getChild("LinkLabel");
      const u = node.node.getChild("URL");
      if (l && u && normalizeLabel(state.sliceDoc(l.from, l.to)) === want) {
        found = cleanUrl(state.sliceDoc(u.from, u.to));
      }
    },
  });
  return found;
}

/** The URL of the Link, Autolink or bare URL at `pos`, or null. */
export function linkUrlAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, side);
    for (; node; node = node.parent) {
      if (node.name === "Image" || node.name === "LinkReference") return null;
      if (node.name === "Link") {
        const url = node.getChild("URL");
        if (url) return cleanUrl(state.sliceDoc(url.from, url.to));
        const label = node.getChild("LinkLabel");
        if (label) return definitionUrl(state, state.sliceDoc(label.from, label.to));
        const marks = node.getChildren("LinkMark");
        const open = marks[0];
        const close = marks[1];
        return open && close ? definitionUrl(state, state.sliceDoc(open.to, close.from)) : null;
      }
      if (node.name === "Autolink" || node.name === "URL") {
        const url = node.name === "URL" ? node : node.getChild("URL");
        if (!url) return null;
        const text = cleanUrl(state.sliceDoc(url.from, url.to));
        return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `mailto:${text}`;
      }
    }
  }
  return null;
}
