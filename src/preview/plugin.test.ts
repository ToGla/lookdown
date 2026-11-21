import { describe, expect, it } from "vitest";
import { buildDecorations } from "./decorations";
import { atomicOnly } from "./plugin";
import { describeDecorations, mdState } from "./test-helpers";

describe("atomicOnly", () => {
  it("keeps hides and widgets, drops marks and lines", () => {
    const s = mdState("# **b** - x\n\n- [ ] t", { reveal: false });
    const all = describeDecorations(buildDecorations(s, 0, s.doc.length));
    expect(all.some((l) => l.startsWith("mark"))).toBe(true);
    expect(all.some((l) => l.startsWith("line"))).toBe(true);
    const out = describeDecorations(atomicOnly(buildDecorations(s, 0, s.doc.length)));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((l) => l.startsWith("hide") || l.startsWith("widget"))).toBe(true);
    expect(out.some((l) => l.startsWith("widget checkbox"))).toBe(true);
    expect(out.filter((l) => l.startsWith("hide")).length).toBe(
      all.filter((l) => l.startsWith("hide")).length,
    );
  });
});
