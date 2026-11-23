// Pure path helpers; no OS calls. Accepts Windows and POSIX spellings.

interface Parsed {
  prefix: string; // "", "/", "//" (UNC), "C:" or "C:/"
  rooted: boolean;
  segs: string[];
}

function parse(path: string): Parsed {
  let rest = path.split("\\").join("/");
  let prefix = "";
  let rooted = false;
  const drive = /^[A-Za-z]:/.exec(rest);
  if (drive) {
    prefix = drive[0];
    rest = rest.slice(2);
    if (rest.startsWith("/")) {
      prefix += "/";
      rooted = true;
    }
  } else if (rest.startsWith("//")) {
    prefix = "//";
    rooted = true;
  } else if (rest.startsWith("/")) {
    prefix = "/";
    rooted = true;
  }
  const segs: string[] = [];
  for (const s of rest.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") {
      if (segs.length > 0 && segs[segs.length - 1] !== "..") segs.pop();
      else if (!rooted) segs.push("..");
    } else segs.push(s);
  }
  return { prefix, rooted, segs };
}

function join(p: Parsed, segs: string[]): string {
  return p.prefix + segs.join("/");
}

export function pathKey(path: string, caseInsensitive: boolean): string {
  const p = parse(path);
  const key = join(p, p.segs);
  return caseInsensitive ? key.toLowerCase() : key;
}

export function baseName(path: string): string {
  const { segs } = parse(path);
  return segs.length > 0 ? segs[segs.length - 1] : "";
}

export function parentName(path: string): string {
  const { segs } = parse(path);
  return segs.length > 1 ? segs[segs.length - 2] : "";
}

/** Full parent directory path, normalized (used to disambiguate labels). */
export function parentPath(path: string): string {
  const p = parse(path);
  return join(p, p.segs.slice(0, -1));
}

/** Index just past the last `/` or `\` (0 when there is none). */
function nameStart(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
}

/**
 * Appends `.md` when the file name has no extension: no `.` after its first
 * character, so `.notes` gets one too. Separators are kept as given.
 */
export function withMarkdownExtension(path: string): string {
  return path.indexOf(".", nameStart(path) + 1) === -1 ? `${path}.md` : path;
}

/** Where the new-file dialog starts: `untitled.md` beside the active file. */
export function newFileDefaultPath(activePath: string | null): string {
  return activePath === null ? "untitled.md" : `${activePath.slice(0, nameStart(activePath))}untitled.md`;
}
