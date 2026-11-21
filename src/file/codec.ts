// Bytes <-> text for files on disk. lookdown only handles UTF-8, with or
// without a byte order mark; the BOM is remembered so saving writes it back.

export type Decoded =
  | { ok: true; text: string; bom: boolean }
  | { ok: false; error: string };

const NOT_UTF8 = "lookdown only opens UTF-8 files";
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function startsWith(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

export function decode(bytes: Uint8Array): Decoded {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    return { ok: false, error: NOT_UTF8 };
  }
  const bom = startsWith(bytes, UTF8_BOM);
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const text = decoder.decode(bom ? bytes.subarray(UTF8_BOM.length) : bytes);
    return { ok: true, text, bom };
  } catch {
    return { ok: false, error: NOT_UTF8 };
  }
}

export function encode(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM);
  out.set(body, UTF8_BOM.length);
  return out;
}
