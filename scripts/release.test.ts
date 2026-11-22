import { describe, expect, it } from "vitest";
import {
  cargoVersion,
  isSemver,
  packageVersion,
  setCargoVersion,
  setPackageVersion,
} from "./release-lib.mjs";

describe("isSemver", () => {
  it("accepts plain and prerelease versions", () => {
    expect(isSemver("0.1.0")).toBe(true);
    expect(isSemver("1.2.3-rc.1")).toBe(true);
    expect(isSemver("1.0.0-0")).toBe(true);
    expect(isSemver("1.0.0-0a")).toBe(true);
  });
  it("rejects malformed versions", () => {
    expect(isSemver("v0.1.0")).toBe(false);
    expect(isSemver("0.1")).toBe(false);
    expect(isSemver("01.2.3")).toBe(false);
    expect(isSemver("1.0.0-01")).toBe(false);
    expect(isSemver("1.0.0-rc.01")).toBe(false);
  });
});

describe("setPackageVersion", () => {
  const json = `{
  "name": "x",
  "version": "0.1.0",
  "nested": {
    "version": "9.9.9"
  }
}
`;
  it("changes only the top-level version", () => {
    const out = setPackageVersion(json, "0.2.0");
    expect(out).toBe(json.replace('"version": "0.1.0"', '"version": "0.2.0"'));
    expect(out).toContain('"version": "9.9.9"');
    expect(packageVersion(out)).toBe("0.2.0");
  });
});

describe("setCargoVersion", () => {
  const toml = `[package]
name = "lookdown"
version = "0.1.0"
edition = "2024"

[dependencies]
tauri = { version = "2", features = [] }
foo = "1"

[other]
version = "5.5.5"
`;
  it("changes only the [package] version", () => {
    const out = setCargoVersion(toml, "0.2.0");
    expect(out).toBe(toml.replace('version = "0.1.0"', 'version = "0.2.0"'));
    expect(cargoVersion(out)).toBe("0.2.0");
    expect(out).toContain('tauri = { version = "2"');
    expect(out).toContain('version = "5.5.5"');
  });
  it("returns null without a package version", () => {
    expect(cargoVersion("[dependencies]\nversion = \"1.0.0\"\n")).toBeNull();
  });
});
