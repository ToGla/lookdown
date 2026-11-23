// Typed wrappers around the Rust commands in src-tauri/src/files.rs.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl as openExternal } from "@tauri-apps/plugin-opener";

/** Drains the paths waiting to be opened (startup arguments, second instances). */
export function takePaths(): Promise<string[]> {
  return invoke<string[]>("take_paths");
}

/** Calls back when new paths were queued; fetch them with `takePaths`. */
export function onPathsQueued(cb: () => void): Promise<() => void> {
  return listen("paths-queued", () => cb());
}

/** Tells the macOS quit hook whether some tab is unsaved. */
export function setUnsaved(unsaved: boolean): Promise<void> {
  return invoke("set_unsaved", { unsaved });
}

/** Calls back with the payload of each `menu-command` event (macOS menu bar). */
export function onMenuCommand(cb: (payload: unknown) => void): Promise<() => void> {
  return listen<unknown>("menu-command", (event) => cb(event.payload));
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

export interface FileStamp {
  modifiedMs: number;
  size: number;
}

/** Modification time and size; null when the file does not exist. */
export function fileStamp(path: string): Promise<FileStamp | null> {
  return invoke<FileStamp | null>("file_stamp", { path });
}

export function setTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

/** Opens a web or mail URL in the system's default handler. */
export function openUrl(url: string): Promise<void> {
  return openExternal(url);
}

/** Creates an empty file; false when the path already exists (left untouched). */
export function createFile(path: string): Promise<boolean> {
  return invoke<boolean>("create_file", { path });
}
