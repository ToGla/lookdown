// Typed wrappers around the Rust commands in src-tauri/src/files.rs.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl as openExternal } from "@tauri-apps/plugin-opener";

/** The file given on the command line at startup, if any. */
export function initialPath(): Promise<string | null> {
  return invoke<string | null>("initial_path");
}

export async function readFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
}

export async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_file", { path, contents: Array.from(bytes) });
}

export function fileSize(path: string): Promise<number> {
  return invoke<number>("file_size", { path });
}

export function setTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

/** Opens a web or mail URL in the system's default handler. */
export function openUrl(url: string): Promise<void> {
  return openExternal(url);
}
