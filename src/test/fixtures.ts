import { readFileSync } from "node:fs";

/** Valid UTF-8 fixtures: every one must round-trip byte-exact. */
export const FIXTURES = [
  "lf.md",
  "crlf.md",
  "cr.md",
  "mixed.md",
  "bom-lf.md",
  "bom-crlf.md",
  "bom-only.md",
  "no-final-newline.md",
  "empty.md",
];

export function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url)),
  );
}
