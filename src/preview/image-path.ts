// Pure path logic for local images; runs in the webview, so no Node APIs.

export type ImageSource =
  | { kind: "local"; path: string }
  | { kind: "web"; url: string }
  | { kind: "none" };

const DRIVE_ABS = /^[a-zA-Z]:[\\/]/;
const ABSOLUTE = /^([\\/]|[a-zA-Z]:[\\/])/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const ROOT_PART = /^([a-zA-Z]:)?$/;
// Two leading separators (any mix of / and \) mark a UNC or device path:
// //host/share, \\?\C:\x, \\.\x. Touching one on Windows opens an SMB
// connection that sends the user's credentials, so such paths never load.
const DOUBLE_SEP = /^[\\/]{2}/;
const NONE: ImageSource = { kind: "none" };

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function local(path: string): ImageSource {
  return DOUBLE_SEP.test(path) ? NONE : { kind: "local", path };
}

/**
 * Turns an image URL from Markdown into a source. Only local-disk paths are
 * accepted: a `file://` URL needs an empty host or `localhost`, and UNC or
 * device paths (including relative paths under a UNC document) give `none`.
 */
export function resolveImage(docPath: string | null, url: string): ImageSource {
  if (/^https?:/i.test(url)) return { kind: "web", url };

  let text = url.replace(/[?#].*$/s, "");

  if (/^file:\/\//i.test(text)) {
    text = text.slice(7);
    if (/^localhost(?=\/|$)/i.test(text)) text = text.slice(9);
    // Anything else before the path is a remote host.
    if (!text.startsWith("/")) return NONE;
    if (DRIVE_ABS.test(text.slice(1))) text = text.slice(1);
  } else if (SCHEME.test(text) && !DRIVE_ABS.test(text)) {
    return NONE;
  }

  text = decode(text);
  // `?` and `*` are invalid in Windows file names; `\??\UNC\host\...` is an NT
  // prefix path that reaches the network. A bare root (left when a literal `?`
  // starts the stripped query, as in `\??\...`) is never an image.
  if (/[?*]/.test(text) || /^[\\/]*$/.test(text)) return NONE;
  if (ABSOLUTE.test(text)) return local(text);
  // Relative paths under a UNC document would be UNC paths too.
  if (docPath === null || DOUBLE_SEP.test(docPath)) return NONE;

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
  // `..` stops at a lone root part, so it never turns a single leading
  // separator into two; `local` checks again anyway.
  return local(parts.join(sep));
}

const MIME = new Map<string, string>([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
]);

export function imageMime(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return MIME.get(path.slice(dot + 1).toLowerCase()) ?? null;
}
