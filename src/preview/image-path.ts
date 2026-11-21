// Pure path logic for local images; runs in the webview, so no Node APIs.

export type ImageSource =
  | { kind: "local"; path: string }
  | { kind: "web"; url: string }
  | { kind: "none" };

const DRIVE_ABS = /^[a-zA-Z]:[\\/]/;
const ABSOLUTE = /^([\\/]|[a-zA-Z]:[\\/])/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const ROOT_PART = /^([a-zA-Z]:)?$/;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Turns an image URL from Markdown into a source. `file://host/share/x` is
 * treated as the UNC path `//host/share/x`.
 */
export function resolveImage(docPath: string | null, url: string): ImageSource {
  if (/^https?:/i.test(url)) return { kind: "web", url };

  let text = url.replace(/[?#].*$/s, "");

  if (/^file:\/\//i.test(text)) {
    text = text.slice(7);
    if (text.startsWith("/")) {
      if (DRIVE_ABS.test(text.slice(1))) text = text.slice(1);
    } else {
      text = "//" + text;
    }
  } else if (SCHEME.test(text) && !DRIVE_ABS.test(text)) {
    return { kind: "none" };
  }

  text = decode(text);
  if (ABSOLUTE.test(text)) return { kind: "local", path: text };
  if (docPath === null) return { kind: "none" };

  const sep = docPath.includes("\\") ? "\\" : "/";
  const cut = Math.max(docPath.lastIndexOf("/"), docPath.lastIndexOf("\\"));
  const parts = cut < 0 ? [] : docPath.slice(0, cut).split(/[\\/]/);
  for (const seg of text.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1 || (parts.length === 1 && !ROOT_PART.test(parts[0]))) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return { kind: "local", path: parts.join(sep) };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function imageMime(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}
