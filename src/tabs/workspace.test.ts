import { describe, expect, it } from "vitest";
import { Workspace, type TabInfo } from "./workspace";

const t = (id: number, path: string): TabInfo => ({ id, path });
const ids = (w: Workspace<TabInfo>) => w.tabs.map((x) => x.id);

function make(n: number, ci = false) {
  const w = new Workspace<TabInfo>(ci);
  for (let i = 1; i <= n; i++) w.add(t(i, `/d/${i}.md`));
  return w;
}

describe("Workspace", () => {
  it("starts empty", () => {
    const w = new Workspace<TabInfo>(false);
    expect(w.tabs).toEqual([]);
    expect(w.active).toBeNull();
  });
  it("add inserts after the active tab and activates it", () => {
    const w = make(3);
    w.activate(2);
    w.add(t(4, "/d/4.md"));
    expect(ids(w)).toEqual([1, 2, 4, 3]);
    expect(w.active?.id).toBe(4);
  });
  it("remove activates right neighbour, else left, else null", () => {
    const w = make(3);
    w.activate(2);
    w.remove(2);
    expect(w.active?.id).toBe(3);
    w.remove(3);
    expect(w.active?.id).toBe(1);
    w.remove(1);
    expect(w.active).toBeNull();
  });
  it("removing an inactive tab keeps the active one", () => {
    const w = make(3);
    w.activate(1);
    w.remove(3);
    expect(w.active?.id).toBe(1);
  });
  it("unknown ids are no-ops", () => {
    const w = make(2);
    w.activate(99);
    w.remove(99);
    expect(ids(w)).toEqual([1, 2]);
    expect(w.active?.id).toBe(2);
  });
  it("next and previous wrap", () => {
    const w = make(3);
    w.activate(3);
    w.next();
    expect(w.active?.id).toBe(1);
    w.previous();
    expect(w.active?.id).toBe(3);
  });
  it("next and previous do nothing below two tabs", () => {
    const w = make(1);
    w.next();
    w.previous();
    expect(w.active?.id).toBe(1);
  });
  it("find uses pathKey", () => {
    const w = new Workspace<TabInfo>(true);
    w.add(t(1, "C:\\n\\a.md"));
    expect(w.find("c:/n/x/../A.md")?.id).toBe(1);
    expect(w.find("c:/n/b.md")).toBeNull();
    const s = new Workspace<TabInfo>(false);
    s.add(t(1, "/n/a.md"));
    expect(s.find("/n/A.md")).toBeNull();
  });
  it("label disambiguates equal base names", () => {
    const w = new Workspace<TabInfo>(false);
    w.add(t(1, "/x/a/notes.md"));
    w.add(t(2, "/x/b/notes.md"));
    w.add(t(3, "/x/b/other.md"));
    expect(w.label(w.tabs[0])).toBe("notes.md — a");
    expect(w.label(w.tabs[1])).toBe("notes.md — b");
    expect(w.label(w.tabs[2])).toBe("other.md");
    w.remove(1);
    expect(w.label(w.tabs[0])).toBe("notes.md");
  });
  it("label compares case-insensitively only when asked", () => {
    const ci = new Workspace<TabInfo>(true);
    ci.add(t(1, "/a/Notes.md"));
    ci.add(t(2, "/b/notes.md"));
    expect(ci.label(ci.tabs[0])).toBe("Notes.md — a");
    const cs = new Workspace<TabInfo>(false);
    cs.add(t(1, "/a/Notes.md"));
    cs.add(t(2, "/b/notes.md"));
    expect(cs.label(cs.tabs[0])).toBe("Notes.md");
  });
  it("label falls back to the full parent path when parents also match", () => {
    const w = new Workspace<TabInfo>(false);
    w.add(t(1, "/x/a/notes.md"));
    w.add(t(2, "/y/a/notes.md"));
    expect(w.label(w.tabs[0])).toBe("notes.md — /x/a");
    expect(w.label(w.tabs[1])).toBe("notes.md — /y/a");
  });
});
