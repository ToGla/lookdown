import { describe, expect, test } from "vitest";
import { FIXTURES, fixture } from "../test/fixtures";
import { decode, encode } from "./codec";

const NOT_UTF8 = "lookdown only opens UTF-8 files";

describe("decode/encode", () => {
  test.each(FIXTURES)("%s round-trips byte-exact", (name) => {
    const bytes = fixture(name);
    const result = decode(bytes);
    if (!result.ok) throw new Error(result.error);
    expect(encode(result.text, result.bom)).toEqual(bytes);
  });

  test("a UTF-8 BOM is reported and stripped from the text", () => {
    const result = decode(fixture("bom-lf.md"));
    expect(result).toEqual({ ok: true, bom: true, text: "# BOM LF\nline\n" });
  });

  test("a BOM-only file decodes to empty text with a BOM", () => {
    expect(decode(fixture("bom-only.md"))).toEqual({ ok: true, bom: true, text: "" });
  });

  test("files without a BOM report bom: false", () => {
    const result = decode(fixture("lf.md"));
    expect(result.ok && result.bom).toBe(false);
  });

  test("invalid UTF-8 is rejected", () => {
    expect(decode(fixture("invalid-utf8.md"))).toEqual({ ok: false, error: NOT_UTF8 });
  });

  test("a UTF-16 BOM is rejected", () => {
    expect(decode(fixture("utf16le-bom.md"))).toEqual({ ok: false, error: NOT_UTF8 });
    expect(decode(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toEqual({ ok: false, error: NOT_UTF8 });
  });
});
