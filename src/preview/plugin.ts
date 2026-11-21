import { syntaxTree } from "@codemirror/language";
import { type Extension, Prec } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, keymap } from "@codemirror/view";
import { escapePipe, tableKeymap } from "./table-keys";
import { buildDecorations } from "./decorations";
import { isOpenableUrl, linkUrlAt } from "./links";
import { rawTable } from "./table-model";
import { enableReveal, revealEnabled } from "./reveal";
import { toggleTask } from "./tasks";

const MODIFIER_KEYS = new Set(["Control", "Meta", "Shift", "Alt"]);

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** Cmd on macOS, Ctrl elsewhere. */
function isModPressed(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
      this.atomic = atomicOnly(this.decorations);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.field(revealEnabled) !== u.state.field(revealEnabled) ||
        u.startState.field(rawTable) !== u.state.field(rawTable)
      ) {
        this.decorations = this.build(u.view);
        this.atomic = atomicOnly(this.decorations);
      }
    }
    build(view: EditorView): DecorationSet {
      const sets = view.visibleRanges.map((r) => buildDecorations(view.state, r.from, r.to));
      return sets.length === 1 ? sets[0] : Decoration.none.update({ add: sets.flatMap(collect), sort: true });
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        const value = view.plugin(plugin);
        return value ? value.atomic : Decoration.none;
      }),
  },
);

/** Only hidden syntax and widgets are atomic; marks and lines are not. */
export function atomicOnly(set: DecorationSet): DecorationSet {
  const keep = [];
  for (const c = set.iter(); c.value; c.next()) {
    const ld = (c.value.spec as { ld?: string }).ld;
    if (ld === "hide" || ld === "widget") keep.push(c.value.range(c.from, c.to));
  }
  return Decoration.set(keep, true);
}

function collect(set: DecorationSet) {
  const out = [];
  for (const c = set.iter(); c.value; c.next()) out.push(c.value.range(c.from, c.to));
  return out;
}

export function livePreviewPlugin(opts: { openUrl?: (url: string) => void } = {}): Extension {
  const modLink = (e: MouseEvent, view: EditorView): string | null => {
    if (!opts.openUrl || e.button !== 0 || !isModPressed(e)) return null;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return null;
    const url = linkUrlAt(view.state, pos);
    return url !== null && isOpenableUrl(url) ? url : null;
  };
  const setMod = (e: KeyboardEvent, view: EditorView) => {
    view.dom.classList.toggle("cm-ld-mod", isModPressed(e));
    return false;
  };
  const firstInput = (e: Event, view: EditorView) => {
    // Pressing a bare modifier (for Mod+click) is not an edit.
    if (e instanceof KeyboardEvent && MODIFIER_KEYS.has(e.key)) return false;
    // Mod shortcuts (Mod-s to save) are not edits either.
    if (e instanceof KeyboardEvent && isModPressed(e)) return false;
    // A Mod+click on a link opens it; it must not reveal.
    if (e instanceof MouseEvent && modLink(e, view) !== null) return false;
    // A click on a checkbox must not reveal (and remove) it before mousedown.
    if ((e.target as HTMLElement | null)?.classList?.contains("cm-ld-task")) return false;
    if (!view.state.field(revealEnabled)) view.dispatch({ effects: enableReveal.of(null) });
    return false;
  };
  return [
    revealEnabled,
    rawTable,
    livePlugin,
    Prec.high(keymap.of(tableKeymap)),
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text !== "|") return false;
      const spec = escapePipe(view.state, from, to);
      if (!spec) return false;
      view.dispatch(spec);
      return true;
    }),
    EditorView.domEventHandlers({
      pointerdown: firstInput,
      keydown(e, view) {
        setMod(e, view);
        return firstInput(e, view);
      },
      keyup: setMod,
      blur(_e, view) {
        view.dom.classList.remove("cm-ld-mod");
        return false;
      },
      mousedown(e, view) {
        const url = modLink(e, view);
        if (url !== null) {
          e.preventDefault();
          opts.openUrl?.(url);
          return true;
        }
        const target = e.target as HTMLElement | null;
        if (!target?.classList.contains("cm-ld-task")) return false;
        e.preventDefault();
        const spec = toggleTask(view.state, Number(target.dataset.pos));
        if (spec) view.dispatch(spec);
        return true;
      },
    }),
  ];
}
