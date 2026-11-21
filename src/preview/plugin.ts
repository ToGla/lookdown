import { syntaxTree } from "@codemirror/language";
import { type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { buildDecorations } from "./decorations";
import { enableReveal, revealEnabled } from "./reveal";
import { toggleTask } from "./tasks";

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.field(revealEnabled) !== u.state.field(revealEnabled)
      ) {
        this.decorations = this.build(u.view);
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
        return value ? value.decorations : Decoration.none;
      }),
  },
);

function collect(set: DecorationSet) {
  const out = [];
  for (const c = set.iter(); c.value; c.next()) out.push(c.value.range(c.from, c.to));
  return out;
}

export function livePreviewPlugin(opts: { openUrl?: (url: string) => void } = {}): Extension {
  // Stored for the Mod+click link handler (Task 5).
  void opts.openUrl;
  const firstInput = (_e: Event, view: EditorView) => {
    if (!view.state.field(revealEnabled)) view.dispatch({ effects: enableReveal.of(null) });
    return false;
  };
  return [
    revealEnabled,
    livePlugin,
    EditorView.domEventHandlers({
      pointerdown: firstInput,
      keydown: firstInput,
      mousedown(e, view) {
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
