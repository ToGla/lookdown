import { ChangeSet, EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { FIXTURES, fixture } from "../test/fixtures";
import { decode } from "./codec";
import { makeBase, normalized, rebuild } from "./lines";

function rawOf(name: string): string {
  const result = decode(fixture(name));
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

/** Apply a change spec to the normalized text and rebuild the raw text. */
function edit(raw: string, spec: (doc: string) => { from: number; to?: number; insert?: string }): string {
  const base = makeBase(raw);
  const state = EditorState.create({ doc: normalized(base) });
  const tr = state.update({ changes: spec(state.doc.toString()) });
  return rebuild(base, tr.changes);
}

describe("normalized", () => {
  test.each(FIXTURES)("%s splits lines the same way CodeMirror does", (name) => {
    const base = makeBase(rawOf(name));
    const state = EditorState.create({ doc: rawOf(name) });
    expect(normalized(base)).toBe(state.doc.toString());
  });
});

describe("rebuild", () => {
  test.each(FIXTURES)("%s without changes rebuilds the raw text exactly", (name) => {
    const base = makeBase(rawOf(name));
    expect(rebuild(base, ChangeSet.empty(normalized(base).length))).toBe(base.raw);
  });

  test("replacing a word on a CRLF line of a mixed file changes only that word", () => {
    const raw = rawOf("mixed.md");
    const out = edit(raw, (doc) => {
      const from = doc.indexOf("another");
      return { from, to: from + "another".length, insert: "one more" };
    });
    expect(out).toBe(raw.replace("another", "one more"));
  });

  test("a new line typed in a CRLF file gets CRLF", () => {
    const raw = rawOf("crlf.md");
    const out = edit(raw, (doc) => ({ from: doc.indexOf("paragraph"), insert: "\n" }));
    expect(out).toBe(raw.replace("paragraph", "\r\nparagraph"));
  });

  test("joining an LF line with the following CRLF line keeps every other ending", () => {
    const raw = rawOf("mixed.md");
    const out = edit(raw, (doc) => {
      const from = doc.indexOf("lf line\n") + "lf line".length;
      return { from, to: from + 1 };
    });
    expect(out).toBe(raw.replace("lf line\ncrlf line", "lf linecrlf line"));
  });

  test("deleting a CRLF line ending removes both bytes and nothing else", () => {
    const raw = rawOf("mixed.md");
    const out = edit(raw, (doc) => {
      const from = doc.indexOf("crlf line\n") + "crlf line".length;
      return { from, to: from + 1 };
    });
    expect(out).toBe(raw.replace("crlf line\r\nanother", "crlf lineanother"));
  });

  test("typing at the end of a CRLF line keeps the ending after the text", () => {
    const raw = rawOf("crlf.md");
    const out = edit(raw, (doc) => ({ from: doc.indexOf("\nLast"), insert: "!" }));
    expect(out).toBe(raw.replace("paragraph.\r\n", "paragraph.!\r\n"));
  });

  test("typing after a lone CR keeps the CR", () => {
    const raw = rawOf("mixed.md");
    const out = edit(raw, (doc) => ({ from: doc.indexOf("end lf"), insert: ">" }));
    expect(out).toBe(raw.replace("lone cr\rend", "lone cr\r>end"));
  });

  test("pasting multi-line text uses the dominant ending", () => {
    const raw = rawOf("crlf.md");
    const out = edit(raw, (doc) => ({ from: doc.length, insert: "a\nb\n" }));
    expect(out).toBe(raw + "a\r\nb\r\n");
  });

  test("a line break typed right after a lone CR stays a separate line break", () => {
    const raw = rawOf("mixed.md");
    const out = edit(raw, (doc) => ({ from: doc.indexOf("end lf"), insert: "\n" }));
    expect(normalized(makeBase(out))).toBe(normalized(makeBase(raw)).replace("end lf", "\nend lf"));
  });

  test("deleting text between a lone CR and an LF keeps both line breaks", () => {
    const raw = rawOf("mixed.md");
    const out = edit(raw, (doc) => {
      const from = doc.indexOf("end lf");
      return { from, to: from + "end lf".length };
    });
    expect(normalized(makeBase(out))).toBe(normalized(makeBase(raw)).replace("end lf", ""));
  });

  test("a CR line break typed right before an LF stays a separate line break", () => {
    const raw = "a\rb\rc\nd";
    const out = edit(raw, (doc) => ({ from: doc.indexOf("\nd"), insert: "\n" }));
    expect(normalized(makeBase(out))).toBe("a\nb\nc\n\nd");
  });

  test.each(FIXTURES)("%s: random edit sequences always save the editor's lines", (name) => {
    let seed = 1;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = ["", "x", "\n", "\n\n", "ab\ncd", "\r"];
    for (let run = 0; run < 40; run++) {
      let base = makeBase(rawOf(name));
      let state = EditorState.create({ doc: normalized(base) });
      for (let step = 0; step < 15; step++) {
        const len = state.doc.length;
        const from = rand(len + 1);
        const to = Math.min(len, from + rand(4));
        const tr = state.update({ changes: { from, to, insert: pieces[rand(pieces.length)] } });
        state = tr.state;
        const raw = rebuild(base, tr.changes);
        expect(normalized(makeBase(raw))).toBe(state.doc.toString());
        base = makeBase(raw);
      }
    }
  });
});

describe("makeBase dominant ending", () => {
  test("most frequent ending wins", () => {
    expect(makeBase("a\r\nb\r\nc\n").eol).toBe("\r\n");
    expect(makeBase("a\rb\rc\n").eol).toBe("\r");
  });
  test("no line breaks means LF", () => {
    expect(makeBase("x").eol).toBe("\n");
    expect(makeBase("").eol).toBe("\n");
  });
  test("ties mean LF", () => {
    expect(makeBase("a\nb\r\nc").eol).toBe("\n");
  });
});
