// Usage: pnpm release <version>   e.g. pnpm release 0.2.0
// Bumps package.json + Cargo.toml (+ Cargo.lock), commits, and tags v<version>.
// Never pushes.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSemver,
  packageVersion,
  setCargoVersion,
  setPackageVersion,
} from "./release-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "package.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const manifest = "src-tauri/Cargo.toml";

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const v = process.argv[2];
if (!v || !isSemver(v)) {
  fail(`"${v ?? ""}" is not a version (expected MAJOR.MINOR.PATCH, optional -prerelease, no leading "v")`);
}
if (run("git", ["status", "--porcelain"]).trim() !== "") {
  fail("working tree not clean: commit or stash your changes first");
}
if (run("git", ["tag", "-l", `v${v}`]).trim() !== "") {
  fail(`tag v${v} already exists`);
}

const pkg = readFileSync(pkgPath, "utf8");
if (packageVersion(pkg) !== v) {
  const newPkg = setPackageVersion(pkg, v);
  const newCargo = setCargoVersion(readFileSync(cargoPath, "utf8"), v);
  try {
    writeFileSync(pkgPath, newPkg);
    writeFileSync(cargoPath, newCargo);
    try {
      run("cargo", ["update", "-p", "lookdown", "--manifest-path", manifest, "--offline"]);
    } catch {
      run("cargo", ["update", "-p", "lookdown", "--manifest-path", manifest]);
    }
    run("git", ["add", "package.json", manifest, "src-tauri/Cargo.lock"]);
    run("git", ["commit", "-m", `release: v${v}`]);
  } catch (e) {
    console.error(`release: failed part-way (${e instanceof Error ? e.message : e}).`);
    console.error("Files may be half-updated. To undo, run:");
    console.error("  git checkout HEAD -- package.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
    process.exit(1);
  }
}
run("git", ["tag", "-a", `v${v}`, "-m", `lookdown v${v}`]);

console.log(`Tagged v${v}. Nothing was pushed.`);
console.log("Next: pnpm tauri build");
console.log("To publish: git push --follow-tags");
