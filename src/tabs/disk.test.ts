import { describe, expect, it } from "vitest";
import { compareStamp, diskAction, needsOverwriteConfirm, type Stamp } from "./disk";

const a: Stamp = { modifiedMs: 100, size: 10 };
const a2: Stamp = { modifiedMs: 100, size: 10 };
const b: Stamp = { modifiedMs: 200, size: 10 };
const c: Stamp = { modifiedMs: 100, size: 11 };

describe("compareStamp", () => {
  it("null to null is unchanged", () => expect(compareStamp(null, null)).toBe("unchanged"));
  it("stamp to null is deleted", () => expect(compareStamp(a, null)).toBe("deleted"));
  it("null to stamp is returned", () => expect(compareStamp(null, a)).toBe("returned"));
  it("equal stamps are unchanged", () => expect(compareStamp(a, a2)).toBe("unchanged"));
  it("different mtime or size is changed", () => {
    expect(compareStamp(a, b)).toBe("changed");
    expect(compareStamp(a, c)).toBe("changed");
  });
});

describe("diskAction", () => {
  it("unchanged is none", () => expect(diskAction("unchanged", true, null, a)).toBe("none"));
  it("changed and clean reloads", () => expect(diskAction("changed", false, null, b)).toBe("reload"));
  it("returned and clean reloads", () => expect(diskAction("returned", false, null, b)).toBe("reload"));
  it("changed and dirty shows the choice", () => expect(diskAction("changed", true, null, b)).toBe("show-changed"));
  it("returned and dirty shows the choice", () => expect(diskAction("returned", true, a, b)).toBe("show-changed"));
  it("dirty stays quiet when Keep yours was chosen for this version", () => {
    expect(diskAction("changed", true, { ...b }, b)).toBe("none");
  });
  it("deleted shows regardless of dirty", () => {
    expect(diskAction("deleted", false, null, null)).toBe("show-deleted");
    expect(diskAction("deleted", true, null, null)).toBe("show-deleted");
  });
});

describe("needsOverwriteConfirm", () => {
  it("true when the disk changed after the last read", () => expect(needsOverwriteConfirm(a, b)).toBe(true));
  it("true when a deleted file came back", () => expect(needsOverwriteConfirm(null, a)).toBe(true));
  it("false right after our own save recorded the new stamp", () => expect(needsOverwriteConfirm(b, { ...b })).toBe(false));
  it("false when the file is missing", () => {
    expect(needsOverwriteConfirm(a, null)).toBe(false);
    expect(needsOverwriteConfirm(null, null)).toBe(false);
  });
});
