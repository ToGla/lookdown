import { expect, test } from "vitest";
import { OPEN_FILTERS, buttonIndex } from "./host";

test("the open dialog filters Markdown, with an All files option", () => {
  expect(OPEN_FILTERS).toEqual([
    { name: "Markdown", extensions: ["md", "markdown"] },
    { name: "All files", extensions: ["*"] },
  ]);
});

test("dialog answers map to button indexes; anything else is the last (Cancel)", () => {
  const three: [string, string, string] = ["Save", "Don't save", "Cancel"];
  expect(buttonIndex("Save", three)).toBe(0);
  expect(buttonIndex("Don't save", three)).toBe(1);
  expect(buttonIndex("Cancel", three)).toBe(2);
  expect(buttonIndex("Yes", three)).toBe(0);
  expect(buttonIndex("No", three)).toBe(1);
  expect(buttonIndex("", three)).toBe(2);
  const two: [string, string] = ["Overwrite", "Cancel"];
  expect(buttonIndex("Overwrite", two)).toBe(0);
  expect(buttonIndex("Ok", two)).toBe(0);
  expect(buttonIndex("No", two)).toBe(1);
  expect(buttonIndex("Cancel", two)).toBe(1);
});
