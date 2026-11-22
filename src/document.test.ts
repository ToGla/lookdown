import { history, undo } from "@codemirror/commands";
import { EditorState, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { OpenDocument, basename, reloadAnnotation, windowTitle } from "./document";
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
    expect(s.doc.isDirty()).toBe(false);
    expect(await s.doc.save(s.write)).toBe("clean");
    expect(s.writes).toHaveLength(0);
  });

  test("an edit makes it dirty; saving writes exact bytes and makes it clean", async () => {
    const s = session("mixed.md");
    s.replace("another", "one more");
    expect(s.doc.isDirty()).toBe(true);
    expect(await s.doc.save(s.write)).toBe("saved");
    const original = text(fixture("mixed.md"));
    expect(s.writes).toEqual([encode(original.replace("another", "one more"), false)]);
    expect(s.doc.isDirty()).toBe(false);
  });

  test("deleting a line then undoing is clean and saves nothing", async () => {
    const s = session("mixed.md");
    s.replace("crlf line\n", "");
    expect(s.doc.isDirty()).toBe(true);
    s.run(undo);
    expect(s.doc.isDirty()).toBe(false);
    expect(await s.doc.save(s.write)).toBe("clean");
    expect(s.writes).toHaveLength(0);
  });

  test("delete, undo, then edit elsewhere keeps the minority line ending", async () => {
    const s = session("mixed.md");
    s.replace("crlf line\n", "");
    s.run(undo);
    s.replace("end lf", "end LF");
    await s.doc.save(s.write);
    const original = text(fixture("mixed.md"));
    expect(text(s.writes[0])).toBe(original.replace("end lf", "end LF"));
  });

  test("a second save applies only the second edit to the first save's output", async () => {
    const s = session("crlf.md");
    s.replace("Second", "2nd");
    await s.doc.save(s.write);
    s.replace("Last", "Final\nline");
    await s.doc.save(s.write);
    const first = text(s.writes[0]);
    expect(text(s.writes[1])).toBe(first.replace("Last", "Final\r\nline"));
  });

  test("a failed write keeps the document dirty and a later save is still exact", async () => {
    const s = session("mixed.md");
    s.replace("lf line", "LF line");
    await expect(
      s.doc.save(async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(s.doc.isDirty()).toBe(true);
    s.replace("lone cr", "LONE CR");
    await s.doc.save(s.write);
    const original = text(fixture("mixed.md"));
    expect(text(s.writes[0])).toBe(original.replace("lf line", "LF line").replace("lone cr", "LONE CR"));
  });

  test("edits made while a save is writing stay tracked against the saved text", async () => {
    const s = session("crlf.md");
    s.replace("Second", "2nd");
    let finish!: () => void;
    const saving = s.doc.save((_p, bytes) => {
      s.writes.push(bytes);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    s.replace("Last", "Final");
    finish();
    await saving;
    expect(s.doc.isDirty()).toBe(true);
    await s.doc.save(s.write);
    const original = text(fixture("crlf.md"));
    expect(text(s.writes[0])).toBe(original.replace("Second", "2nd"));
    expect(text(s.writes[1])).toBe(original.replace("Second", "2nd").replace("Last", "Final"));
  });

  test("restoring the saved text during a failed write keeps minority endings", async () => {
    const s = session("mixed.md");
    s.replace("crlf line\n", "crlf line");
    let fail!: (e: Error) => void;
    const saving = s.doc.save(() => new Promise<void>((_resolve, reject) => (fail = reject)));
    s.replace("crlf lineanother", "crlf line\nanother");
    fail(new Error("disk full"));
    await expect(saving).rejects.toThrow("disk full");
    expect(s.doc.isDirty()).toBe(false);
    s.replace("end lf", "end LF");
    await s.doc.save(s.write);
    const original = text(fixture("mixed.md"));
    expect(text(s.writes[0])).toBe(original.replace("end lf", "end LF"));
  });

  test("a save started while another is writing waits, then writes the latest text", async () => {
    const s = session("crlf.md");
    s.replace("Second", "2nd");
    let finish!: () => void;
    const first = s.doc.save((_p, bytes) => {
      s.writes.push(bytes);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    s.replace("Last", "Final");
    const second = s.doc.save(s.write);
    expect(s.writes).toHaveLength(1);
    finish();
    await first;
    expect(await second).toBe("saved");
    const original = text(fixture("crlf.md"));
    expect(text(s.writes[1])).toBe(original.replace("Second", "2nd").replace("Last", "Final"));
    expect(s.doc.isDirty()).toBe(false);
  });

  test("a BOM file keeps its BOM after saving", async () => {
    const s = session("bom-crlf.md");
    s.replace("line", "text");
    await s.doc.save(s.write);
    expect(Array.from(s.writes[0].subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(s.writes[0])).toBe("# BOM CRLF\r\ntext\r\n");
  });
});

describe("reload and missing", () => {
  const bytes = (t: string) => new TextEncoder().encode(t);

  test("reloading a clean CRLF document uses the new text and keeps CRLF on save", async () => {
    const s = session("crlf.md");
    const r = s.doc.reload(bytes("one\r\ntwo\r\n"));
    expect(r).toEqual({ text: "one\ntwo\n" });
    expect(s.doc.initialText).toBe("one\ntwo\n");
    expect(s.doc.isDirty()).toBe(false);
    // Load the reloaded text into the editor the way the app does.
    s.apply({
      changes: { from: 0, to: s.state.doc.length, insert: "one\ntwo\n" },
      annotations: reloadAnnotation.of(true),
    });
    s.replace("two", "2\nx");
    await s.doc.save(s.write);
    expect(text(s.writes[0])).toBe("one\r\n2\r\nx\r\n");
  });

  test("reload with invalid UTF-8 errors and leaves the document unchanged", () => {
    const s = session("mixed.md");
    s.replace("lf line", "LF line");
    const before = s.doc.initialText;
    expect(s.doc.reload(fixture("invalid-utf8.md"))).toEqual({
      error: "lookdown only opens UTF-8 files",
    });
    expect(s.doc.initialText).toBe(before);
    expect(s.doc.isDirty()).toBe(true);
  });

  test("markMissing makes it dirty without touching text; save clears it", async () => {
    const s = session("mixed.md");
    const before = s.doc.initialText;
    s.doc.markMissing();
    expect(s.doc.missing).toBe(true);
    expect(s.doc.isDirty()).toBe(true);
    expect(s.doc.initialText).toBe(before);
    expect(await s.doc.save(s.write)).toBe("saved");
    expect(s.writes[0]).toEqual(fixture("mixed.md"));
    expect(s.doc.missing).toBe(false);
    expect(s.doc.isDirty()).toBe(false);
  });

  test("reload clears missing", () => {
    const s = session("mixed.md");
    s.doc.markMissing();
    s.doc.reload(bytes("new\n"));
    expect(s.doc.missing).toBe(false);
    expect(s.doc.isDirty()).toBe(false);
  });

  test("track ignores a reload-annotated transaction", () => {
    const s = session("crlf.md");
    s.apply({ changes: { from: 0, insert: "zzz" }, annotations: reloadAnnotation.of(true) });
    expect(s.doc.isDirty()).toBe(false);
  });

  test("a reload during a running save is applied after the save settles", async () => {
    const s = session("crlf.md");
    s.replace("Second", "2nd");
    let finish!: () => void;
    const saving = s.doc.save(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(s.doc.reload(bytes("fresh\r\n"))).toEqual({ text: "fresh\n" });
    finish();
    await saving;
    await Promise.resolve();
    expect(s.doc.initialText).toBe("fresh\n");
    expect(s.doc.isDirty()).toBe(false);
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
