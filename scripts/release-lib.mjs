// Pure helpers for scripts/release.mjs: no I/O.

// Prerelease identifiers: numeric ones have no leading zeros, others contain a non-digit.
const PRE_ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-${PRE_ID}(\.${PRE_ID})*)?$`,
);

export function isSemver(v) {
  return typeof v === "string" && SEMVER.test(v);
}

// The top-level "version" line is the one indented by exactly two spaces.
const PACKAGE_VERSION = /^(  "version"\s*:\s*")([^"]*)(")/m;

export function packageVersion(json) {
  return JSON.parse(json).version;
}

export function setPackageVersion(json, v) {
  if (!PACKAGE_VERSION.test(json)) throw new Error("no top-level version in package.json");
  return json.replace(PACKAGE_VERSION, (_, a, _old, c) => `${a}${v}${c}`);
}

// Locates the [package] table body: from its header to the next table header.
function packageTable(toml) {
  const head = /^\[package\][ \t]*\r?$/m.exec(toml);
  if (!head) return null;
  const start = head.index + head[0].length;
  const next = /^\[/m.exec(toml.slice(start));
  return { start, end: next ? start + next.index : toml.length };
}

const CARGO_VERSION = /^(version\s*=\s*")([^"]*)(")/m;

export function cargoVersion(toml) {
  const t = packageTable(toml);
  if (!t) return null;
  const m = CARGO_VERSION.exec(toml.slice(t.start, t.end));
  return m ? m[2] : null;
}

export function setCargoVersion(toml, v) {
  const t = packageTable(toml);
  if (!t || !CARGO_VERSION.test(toml.slice(t.start, t.end))) {
    throw new Error("no [package] version in Cargo.toml");
  }
  const body = toml
    .slice(t.start, t.end)
    .replace(CARGO_VERSION, (_, a, _old, c) => `${a}${v}${c}`);
  return toml.slice(0, t.start) + body + toml.slice(t.end);
}
