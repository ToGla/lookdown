import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

const OPENABLE = /^(https?:|mailto:)/i;

export function isOpenableUrl(url: string): boolean {
  return OPENABLE.test(url);
}

// A URL node inside one of these is a destination, never an email address.
const LINK_PARTS = new Set(["Link", "Image", "LinkReference"]);

/** Reference labels match case-insensitively with whitespace collapsed. */
export function normalizeLabel(label: string): string {
  return label.replace(/^\[|\]$/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanUrl(raw: string): string {
  const t = raw.trim();
  return t.startsWith("<") && t.endsWith(">") ? t.slice(1, -1) : t;
}

const definitionCache = new WeakMap<Tree, Map<string, string>>();

/** Normalized label to URL for every link reference definition, built once per tree. */
function definitions(state: EditorState): Map<string, string> {
  const tree = syntaxTree(state);
  let defs = definitionCache.get(tree);
  if (!defs) {
    const found = new Map<string, string>();
    tree.iterate({
      enter(node) {
        if (node.name !== "LinkReference") return;
        const l = node.node.getChild("LinkLabel");
        const u = node.node.getChild("URL");
        if (l && u) {
          const key = normalizeLabel(state.sliceDoc(l.from, l.to));
          if (!found.has(key)) found.set(key, cleanUrl(state.sliceDoc(u.from, u.to)));
        }
        return false;
      },
    });
    defs = found;
    definitionCache.set(tree, defs);
  }
  return defs;
}

/**
 * The destination of a Link node: its inline URL, or that of the matching
 * reference definition (`[t][r]`, collapsed `[t][]`, shortcut `[t]`).
 * Null means there is none, so the brackets are plain text.
 */
export function linkTarget(state: EditorState, link: SyntaxNode): string | null {
  const url = link.getChild("URL");
  if (url) return cleanUrl(state.sliceDoc(url.from, url.to));
  const defs = definitions(state);
  const label = link.getChild("LinkLabel");
  if (label) {
    const key = normalizeLabel(state.sliceDoc(label.from, label.to));
    if (key !== "") return defs.get(key) ?? null;
  }
  // Collapsed `[t][]` or shortcut `[t]`: the link text is the label.
  const marks = link.getChildren("LinkMark");
  const open = marks[0];
  const close = marks[1];
  if (!open || !close) return null;
  return defs.get(normalizeLabel(state.sliceDoc(open.to, close.from))) ?? null;
}

/** The URL of the Link, Autolink or bare URL at `pos`, or null. */
export function linkUrlAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, side);
    for (; node; node = node.parent) {
      if (node.name === "Image" || node.name === "LinkReference") return null;
      if (node.name === "Link") return linkTarget(state, node);
      if (node.name === "URL" && node.parent && LINK_PARTS.has(node.parent.name)) continue;
      if (node.name === "Autolink" || node.name === "URL") {
        const url = node.name === "URL" ? node : node.getChild("URL");
        if (!url) return null;
        const text = cleanUrl(state.sliceDoc(url.from, url.to));
        if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
        if (node.name === "URL" && /^www\./i.test(text)) return `https://${text}`;
        const email = node.name === "Autolink" || /^[^\s/:]+@[^\s/:]+$/.test(text);
        return email ? `mailto:${text}` : null;
      }
    }
  }
  return null;
}
