import { describe, expect, it } from "vitest";
import { buildDecorations } from "./decorations";
import { at, describeDecorations, mdState } from "./test-helpers";

function run(doc: string, opts: Parameters<typeof mdState>[1] = {}): string[] {
  const s = mdState(doc, opts);
  return describeDecorations(buildDecorations(s, 0, s.doc.length)).sort();
}
const sorted = (a: string[]) => [...a].sort();

describe("block decorations", () => {
  it("ATX heading", () => {
    expect(run("## Two")).toEqual(sorted(["line cm-ld-h2 0", "hide 0-3"]));
  });
  it("setext heading", () => {
    const out = run("Title\n===");
    expect(out).toContain("line cm-ld-h1 0");
    expect(out).toContain("hide 6-9");
  });
  it("setext underline in a quote or indent gets no heading class", () => {
    expect(run("> a\n> ---").filter((l) => l.includes("cm-ld-h2"))).toEqual(["line cm-ld-h2 0"]);
    expect(run("  a\n  ---").filter((l) => l.includes("cm-ld-h2"))).toEqual(["line cm-ld-h2 0"]);
  });
  it("clamps line classes to the build range", () => {
    const doc = "```\n" + Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n") + "\n```";
    const s = mdState(doc);
    const l100 = s.doc.line(100);
    const out = describeDecorations(buildDecorations(s, l100.from, l100.to));
    const lines = out.filter((l) => l.startsWith("line cm-ld-codeblock"));
    expect(lines).toContain(`line cm-ld-codeblock ${l100.from}`);
    expect(lines.length).toBeLessThanOrEqual(3);
    const qs = mdState("> x\n".repeat(200));
    const q100 = qs.doc.line(100);
    const qo = describeDecorations(buildDecorations(qs, q100.from, q100.to));
    expect(qo.filter((l) => l.startsWith("line cm-ld-quote")).length).toBeLessThanOrEqual(3);
  });
  it("blockquote", () => {
    expect(run("> q")).toEqual(sorted(["line cm-ld-quote 0", "hide 0-2"]));
  });
  it("nested blockquote", () => {
    expect(run("> > q")).toEqual(
      sorted(["line cm-ld-quote 0", "line cm-ld-quote-2 0", "hide 0-2", "hide 2-4"]),
    );
  });
  it("bullet list", () => {
    expect(run("- a")).toEqual(["widget bullet 0-1"]);
  });
  it("ordered list stays text", () => {
    expect(run("1. a")).toEqual([]);
  });
  it("task checkbox", () => {
    expect(run("- [ ] t")).toEqual(sorted(["widget bullet 0-1", "widget checkbox 2-5"]));
    expect(run("- [X] t")).toEqual(sorted(["widget bullet 0-1", "widget checkbox 2-5"]));
    const s = mdState("- [X] t");
    const set = buildDecorations(s, 0, s.doc.length);
    const found: boolean[] = [];
    for (const c = set.iter(); c.value; c.next()) {
      const w = (c.value.spec as { widget?: { name: string; checked?: boolean; pos?: number } })
        .widget;
      if (w?.name === "checkbox") found.push(w.checked === true && w.pos === 3);
    }
    expect(found).toEqual([true]);
  });
  it("revealed task has no widgets", () => {
    expect(run("- [ ] t", { reveal: true, selection: { anchor: 3 } })).toEqual([]);
  });
  it("horizontal rule", () => {
    expect(run("a\n\n---")).toEqual(["widget rule 3-6"]);
  });
  it("setext heading is not a rule", () => {
    expect(run("a\n---")).not.toContain("widget rule 2-5");
  });
  it("fenced code", () => {
    const doc = "```js\n# x\n```";
    const out = run(doc);
    expect(out.filter((l) => l.startsWith("line cm-ld-codeblock"))).toEqual(
      sorted(["line cm-ld-codeblock 0", "line cm-ld-codeblock 6", "line cm-ld-codeblock 10"]),
    );
    expect(out).toContain("line cm-ld-fence 0");
    expect(out).toContain("line cm-ld-fence 10");
    expect(out).not.toContain("line cm-ld-fence 6");
    expect(out).toContain("line cm-ld-fence-hidden 0");
    expect(out).toContain("line cm-ld-fence-hidden 10");
    expect(out).not.toContain("line cm-ld-fence-hidden 6");
    expect(out).toContain("hide 0-5");
    expect(out).toContain("hide 10-13");
    expect(out.some((l) => l.includes("cm-ld-h1"))).toBe(false);
  });
  it("revealed fenced code", () => {
    const out = run("```js\n# x\n```", { reveal: true, selection: { anchor: 7 } });
    expect(out.some((l) => l.includes("cm-ld-fence-hidden"))).toBe(false);
    expect(out.some((l) => l.startsWith("hide"))).toBe(false);
    expect(out).toContain("line cm-ld-fence 0");
  });
  it("indented code", () => {
    expect(run("    code")).toEqual(["line cm-ld-codeblock 0"]);
  });
  it("nesting", () => {
    const doc = "> - [x] done\n>   - sub";
    const out = run(doc);
    expect(out).toContain("line cm-ld-quote 0");
    expect(out).toContain(`line cm-ld-quote ${at(mdState(doc), "\n") + 1}`);
    expect(out.filter((l) => l.startsWith("widget checkbox"))).toHaveLength(1);
    expect(out.filter((l) => l.startsWith("widget bullet"))).toHaveLength(2);
  });
  it("html stays text", () => {
    expect(run("<b>x</b>")).toEqual([]);
  });
  it("never hides or replaces across a line break", () => {
    const doc = "[t](u\n\"x\")";
    const s = mdState(doc);
    const out = describeDecorations(buildDecorations(s, 0, s.doc.length));
    expect(out.some((l) => l.startsWith("hide"))).toBe(true);
    for (const l of out) {
      const m = /^(?:hide|widget \w+) (\d+)-(\d+)$/.exec(l);
      if (m) expect(s.doc.sliceString(+m[1], +m[2])).not.toContain("\n");
    }
  });
});
