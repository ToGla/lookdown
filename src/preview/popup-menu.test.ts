import { describe, expect, it } from "vitest";
import { closeMenu } from "./popup-menu";

describe("closeMenu", () => {
  it("is a no-op when no menu is open", () => {
    expect(() => closeMenu()).not.toThrow();
  });
});
