import { history, undo } from "@codemirror/commands";
import { EditorState, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { OpenDocument, basename, windowTitle } from "./document";
import { decode, encode } from "./file/codec";
import { fixture } from "./test/fixtures";

function text(bytes: Uint8Array): string {
  const result = decode(bytes);
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

/** An open document plus an editor state that reports every transaction to it. */
function session(name: string) {
  const doc = OpenDocument.fromBytes(`/notes/${name}`, fixture(name));
  if ("error" in doc) throw new Error(doc.error);
  let state = EditorState.create({ doc: doc.initialText, extensions: [history()] });
  const dispatch = (tr: ReturnType<EditorState["update"]>) => {
    doc.track(tr);
    state = tr.state;
  };
  const writes: Uint8Array[] = [];
  return {
    doc,
    writes,
    get state() {
      return state;
    },
    apply(spec: TransactionSpec) {
      dispatch(state.update(spec));
    },
    run(command: StateCommand) {
      command({ state, dispatch });
    },
    replace(find: string, insert: string) {
      const from = state.doc.toString().indexOf(find);
      if (from < 0) throw new Error(`not found: ${find}`);
      dispatch(state.update({ changes: { from, to: from + find.length, insert } }));
    },
    write: async (_path: string, bytes: Uint8Array) => {
      writes.push(bytes);
    },
  };
}

describe("OpenDocument", () => {
  test("a non-UTF-8 file gives an error", () => {
    expect(OpenDocument.fromBytes("/x.md", fixture("invalid-utf8.md"))).toEqual({
      error: "lookdown only opens UTF-8 files",
    });
  });

  test("saving an unedited document writes nothing", async () => {
    const s = session("mixed.md");
    expect(s.doc.isDirty(s.state.doc)).toBe(false);
    expect(await s.doc.save(s.state.doc, s.write)).toBe("clean");
    expect(s.writes).toHaveLength(0);
  });

  test("an edit makes it dirty; saving writes exact bytes and makes it clean", async () => {
    const s = session("mixed.md");
    s.replace("another", "one more");
    expect(s.doc.isDirty(s.state.doc)).toBe(true);
    expect(await s.doc.save(s.state.doc, s.write)).toBe("saved");
    const original = text(fixture("mixed.md"));
    expect(s.writes).toEqual([encode(original.replace("another", "one more"), false)]);
    expect(s.doc.isDirty(s.state.doc)).toBe(false);
  });

  test("deleting a line then undoing is clean and saves nothing", async () => {
    const s = session("mixed.md");
    s.replace("crlf line\n", "");
    expect(s.doc.isDirty(s.state.doc)).toBe(true);
    s.run(undo);
    expect(s.doc.isDirty(s.state.doc)).toBe(false);
    expect(await s.doc.save(s.state.doc, s.write)).toBe("clean");
    expect(s.writes).toHaveLength(0);
  });

  test("delete, undo, then edit elsewhere keeps the minority line ending", async () => {
    const s = session("mixed.md");
    s.replace("crlf line\n", "");
    s.run(undo);
    s.replace("end lf", "end LF");
    await s.doc.save(s.state.doc, s.write);
    const original = text(fixture("mixed.md"));
    expect(text(s.writes[0])).toBe(original.replace("end lf", "end LF"));
  });

  test("a second save applies only the second edit to the first save's output", async () => {
    const s = session("crlf.md");
    s.replace("Second", "2nd");
    await s.doc.save(s.state.doc, s.write);
    s.replace("Last", "Final\nline");
    await s.doc.save(s.state.doc, s.write);
    const first = text(s.writes[0]);
    expect(text(s.writes[1])).toBe(first.replace("Last", "Final\r\nline"));
  });

  test("a failed write keeps the document dirty and a later save is still exact", async () => {
    const s = session("mixed.md");
    s.replace("lf line", "LF line");
    await expect(
      s.doc.save(s.state.doc, async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(s.doc.isDirty(s.state.doc)).toBe(true);
    s.replace("lone cr", "LONE CR");
    await s.doc.save(s.state.doc, s.write);
    const original = text(fixture("mixed.md"));
    expect(text(s.writes[0])).toBe(original.replace("lf line", "LF line").replace("lone cr", "LONE CR"));
  });

  test("edits made while a save is writing stay tracked against the saved text", async () => {
    const s = session("crlf.md");
    s.replace("Second", "2nd");
    let finish!: () => void;
    const saving = s.doc.save(s.state.doc, (_p, bytes) => {
      s.writes.push(bytes);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    s.replace("Last", "Final");
    finish();
    await saving;
    expect(s.doc.isDirty(s.state.doc)).toBe(true);
    await s.doc.save(s.state.doc, s.write);
    const original = text(fixture("crlf.md"));
    expect(text(s.writes[0])).toBe(original.replace("Second", "2nd"));
    expect(text(s.writes[1])).toBe(original.replace("Second", "2nd").replace("Last", "Final"));
  });

  test("a BOM file keeps its BOM after saving", async () => {
    const s = session("bom-crlf.md");
    s.replace("line", "text");
    await s.doc.save(s.state.doc, s.write);
    expect(Array.from(s.writes[0].subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(s.writes[0])).toBe("# BOM CRLF\r\ntext\r\n");
  });
});

describe("titles", () => {
  test("basename handles both path separators", () => {
    expect(basename("C:\\notes\\b.md")).toBe("b.md");
    expect(basename("/notes/b.md")).toBe("b.md");
  });
  test("window title marks unsaved changes", () => {
    expect(windowTitle("/notes/b.md", false)).toBe("b.md — lookdown");
    expect(windowTitle("/notes/b.md", true)).toBe("• b.md — lookdown");
  });
});
