import { describe, expect, it } from "vitest";
import { menuItems } from "./table-menu";
import { at, mdState } from "./test-helpers";

const T = "| a | bb |\n|---|---|\n| c | d |";
const ONE = "| a |\n|---|\n| c |";
const labels = [
  "Insert row above",
  "Insert row below",
  "Delete row",
  "Insert column left",
  "Insert column right",
  "Delete column",
  "Align left",
  "Align center",
  "Align right",
  "Edit as Markdown",
];

describe("menuItems", () => {
  it("lists labels in order", () => {
    const s = mdState(T);
    expect(menuItems(s, at(s, "d"))!.map((i) => i.label)).toEqual(labels);
  });
  it("disables row above/delete on the header", () => {
    const s = mdState(T);
    const m = Object.fromEntries(menuItems(s, at(s, "a"))!.map((i) => [i.label, i.disabled]));
    expect(m["Insert row above"]).toBe(true);
    expect(m["Delete row"]).toBe(true);
    expect(m["Insert row below"]).toBe(false);
    expect(m["Edit as Markdown"]).toBe(false);
  });
  it("disables Delete column on a 1-column table", () => {
    const s = mdState(ONE);
    const m = Object.fromEntries(menuItems(s, at(s, "c"))!.map((i) => [i.label, i.disabled]));
    expect(m["Delete column"]).toBe(true);
  });
  it("is null outside a table", () => {
    const s = mdState("hello\n\n" + T);
    expect(menuItems(s, 2)).toBeNull();
  });
});
