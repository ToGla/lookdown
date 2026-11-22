// Images render as block widgets under the line that holds them. Block widgets
// may only come from a StateField, so this lives apart from livePlugin.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { ImageCache } from "./image-loader";
import { type ImageSource, resolveImage } from "./image-path";
import { isOpenableUrl, linkTarget } from "./links";
import { isGridTable } from "./table-model";

export interface PreviewConfig {
  docPath: string | null;
  images: ImageCache | null;
}

export const previewConfig = Facet.define<PreviewConfig, PreviewConfig>({
  combine: (values) => values[0] ?? { docPath: null, images: null },
});

/** The text between `![` and `]`. */
export function imageAlt(state: EditorState, image: SyntaxNode): string {
  const marks = image.getChildren("LinkMark");
  const open = marks[0];
  const close = marks[1];
  return open && close ? state.sliceDoc(open.to, close.from) : "";
}

/** The grid table holding this node, or null. */
export function gridTableOf(node: SyntaxNode): SyntaxNode | null {
  for (let n: SyntaxNode | null = node.parent; n; n = n.parent) {
    if (n.name === "Table") return isGridTable(n) ? n : null;
  }
  return null;
}

export interface ImageBlock {
  pos: number;
  alt: string;
  source: ImageSource;
  href: string | null;
}

/** Every image outside grid-table cells, in source order. */
export function imageBlocks(state: EditorState): ImageBlock[] {
  const { docPath } = state.facet(previewConfig);
  const out: ImageBlock[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== "Image") return;
      const node = ref.node;
      if (gridTableOf(node)) return false;
      // No destination (`![x]`, an undefined reference, `![[x]]`): plain text, like links.
      const url = linkTarget(state, node);
      if (url === null) return false;
      let href: string | null = null;
      const link = node.parent?.name === "Link" ? node.parent : null;
      if (link) {
        const target = linkTarget(state, link);
        if (target !== null && isOpenableUrl(target)) href = target;
      }
      out.push({
        pos: state.doc.lineAt(node.to).to,
        alt: imageAlt(state, node),
        source: resolveImage(docPath, url),
        href,
      });
      return false;
    },
  });
  return out;
}

function placeholderText(alt: string, detail: string): string {
  return alt === "" ? detail : `${alt} — ${detail}`;
}

function missing(alt: string, detail: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-ld-image-missing";
  el.textContent = placeholderText(alt, detail);
  return el;
}

function sameSource(a: ImageSource, b: ImageSource): boolean {
  if (a.kind === "local" && b.kind === "local") return a.path === b.path;
  if (a.kind === "web" && b.kind === "web") return a.url === b.url;
  return a.kind === b.kind;
}

/** Asks to load the web image at this URL. Not undoable; lasts for the session. */
export const loadWebImage = StateEffect.define<string>();

/** Load attempts per web URL; a retry bumps it, which rebuilds that URL's widgets. */
export const loadedWebImages = StateField.define<ReadonlyMap<string, number>>({
  create: () => new Map(),
  update(value, tr) {
    let next: Map<string, number> | null = null;
    for (const e of tr.effects) {
      if (!e.is(loadWebImage)) continue;
      next ??= new Map(value);
      next.set(e.value, (next.get(e.value) ?? 0) + 1);
    }
    return next ?? value;
  },
});

/** Asks local images to render again, e.g. after files changed on disk. Not undoable. */
export const retryImages = StateEffect.define<null>();

const imageEpoch = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    return tr.effects.some((e) => e.is(retryImages)) ? value + 1 : value;
  },
});

export class ImageBlockWidget extends WidgetType {
  readonly name = "image";
  constructor(
    readonly alt: string,
    readonly source: ImageSource,
    readonly href: string | null,
    readonly loaded: boolean,
    /** Web: load attempts. Local: the retry epoch. A change redraws the widget. */
    readonly version: number = 0,
  ) {
    super();
  }
  eq(other: WidgetType): boolean {
    return (
      other instanceof ImageBlockWidget &&
      other.alt === this.alt &&
      other.href === this.href &&
      other.loaded === this.loaded &&
      other.version === this.version &&
      sameSource(other.source, this.source)
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "cm-ld-image";
    const href = this.href ?? (this.source.kind === "web" ? this.source.url : null);
    if (href !== null) dom.dataset.ldHref = href;

    const source = this.source;
    if (source.kind === "web") {
      if (!this.loaded) {
        const placeholder = missing(this.alt, source.url);
        placeholder.dataset.ldWeb = source.url;
        dom.append(placeholder);
        return dom;
      }
      const img = document.createElement("img");
      img.alt = this.alt;
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        img.onload = img.onerror = null;
        if (img.isConnected) view.requestMeasure();
      };
      img.onerror = () => {
        img.onload = img.onerror = null;
        // Keeps data-ld-web, so the menu offers "Load image" again.
        const failed = missing(this.alt, "image could not be loaded");
        failed.dataset.ldWeb = source.url;
        dom.replaceChildren(failed);
        if (dom.isConnected) view.requestMeasure();
      };
      img.src = source.url;
      dom.append(img);
      return dom;
    }
    const images = view.state.facet(previewConfig).images;
    if (source.kind === "none" || !images) {
      dom.append(missing(this.alt, "image not found"));
      return dom;
    }
    void images.load(source.path).then((loaded) => {
      if ("error" in loaded) {
        dom.replaceChildren(missing(this.alt, loaded.error === "too-large" ? "image too large" : "image not found"));
        if (dom.isConnected) view.requestMeasure();
        return;
      }
      const img = document.createElement("img");
      img.alt = this.alt;
      img.onload = img.onerror = () => {
        img.onload = img.onerror = null;
        if (img.isConnected) view.requestMeasure();
      };
      img.src = loaded.url;
      dom.replaceChildren(img);
    });
    return dom;
  }
  destroy(dom: HTMLElement): void {
    const img = dom.querySelector("img");
    if (img) img.onload = img.onerror = null;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function imageState(
  source: ImageSource,
  attempts: ReadonlyMap<string, number> | undefined,
  epoch: number,
): [loaded: boolean, version: number] {
  if (source.kind === "web") {
    const n = attempts?.get(source.url) ?? 0;
    return [n > 0, n];
  }
  return [false, source.kind === "local" ? epoch : 0];
}

function buildImages(state: EditorState): DecorationSet {
  const attempts = state.field(loadedWebImages, false);
  const epoch = state.field(imageEpoch, false) ?? 0;
  return Decoration.set(
    imageBlocks(state).map((b) =>
      Decoration.widget({
        widget: new ImageBlockWidget(b.alt, b.source, b.href, ...imageState(b.source, attempts, epoch)),
        block: true,
        side: 1,
        ld: "widget",
      }).range(b.pos),
    ),
  );
}

export const imageField = StateField.define<DecorationSet>({
  create: buildImages,
  update(value, tr) {
    if (
      tr.docChanged ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.startState.field(loadedWebImages, false) !== tr.state.field(loadedWebImages, false) ||
      tr.startState.field(imageEpoch, false) !== tr.state.field(imageEpoch, false)
    )
      return buildImages(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function localPaths(set: DecorationSet): Set<string> {
  const paths = new Set<string>();
  for (const c = set.iter(); c.value; c.next()) {
    const w = c.value.spec.widget;
    if (w instanceof ImageBlockWidget && w.source.kind === "local") paths.add(w.source.path);
  }
  return paths;
}

/** Revokes object URLs of images no longer in the document. */
export const imageRetainer = ViewPlugin.define((view) => ({
  update(u) {
    const set = u.state.field(imageField);
    if (set !== u.startState.field(imageField)) u.state.facet(previewConfig).images?.retain(localPaths(set));
  },
  destroy() {
    view.state.facet(previewConfig).images?.retain(new Set());
  },
}));

export function imageExtensions(config: PreviewConfig) {
  return [previewConfig.of(config), loadedWebImages, imageEpoch, imageField, imageRetainer];
}
