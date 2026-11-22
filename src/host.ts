// Everything the app shell needs from the OS, behind one interface so the dev
// harness and the unit tests can run the whole shell with fake files.

import { message, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import * as native from "./native";
import type { Stamp } from "./tabs/disk";

export interface Host {
  isMac: boolean;
  caseInsensitivePaths: boolean;
  /** Drains the paths waiting to be opened (startup arguments, second instances). */
  takePaths(): Promise<string[]>;
  /** Calls back when new paths were queued; register before the first `takePaths`. */
  onPathsQueued(cb: () => void): void;
  onFilesDropped(cb: (paths: string[]) => void): void;
  /** Native open dialog, multiple selection; empty when cancelled. */
  pickFiles(): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  fileSize(path: string): Promise<number>;
  fileStamp(path: string): Promise<Stamp | null>;
  setTitle(title: string): void;
  openUrl(url: string): Promise<void>;
  /** Index of the button chosen; the last button is Cancel (also on escape). */
  ask(message: string, buttons: [string, string, string?]): Promise<0 | 1 | 2>;
  /** Resolve true to let the window close. */
  onCloseRequested(cb: () => Promise<boolean>): void;
  onFocus(cb: () => void): void;
}

export const OPEN_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown"] },
  { name: "All files", extensions: ["*"] },
];

/** Maps the dialog plugin's answer (a button label) to the button's index. */
export function buttonIndex(answer: string, buttons: [string, string, string?]): 0 | 1 | 2 {
  const labels = buttons.filter((b): b is string => b !== undefined);
  const last = (labels.length - 1) as 1 | 2;
  const i = labels.indexOf(answer);
  if (i >= 0) return i as 0 | 1 | 2;
  // Some platforms answer with the default names instead of the custom labels.
  if (answer === "Yes" || answer === "Ok") return 0;
  if (answer === "No" && labels.length === 3) return 1;
  return last;
}

export function tauriHost(): Host {
  const platform = navigator.userAgent;
  const isMac = /Mac/i.test(platform);
  const isWindows = /Windows/i.test(platform);
  // Paths queued before the listener exists would be missed: takePaths waits for it.
  let listening: Promise<unknown> = Promise.resolve();

  return {
    isMac,
    caseInsensitivePaths: isWindows,
    async takePaths() {
      await listening.catch(() => undefined);
      return native.takePaths();
    },
    onPathsQueued(cb) {
      listening = native.onPathsQueued(cb);
    },
    onFilesDropped(cb) {
      void getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length > 0) cb(event.payload.paths);
      });
    },
    async pickFiles() {
      const picked = await open({ multiple: true, directory: false, filters: OPEN_FILTERS });
      return picked ?? [];
    },
    readFile: native.readFile,
    writeFile: native.writeFile,
    fileSize: native.fileSize,
    fileStamp: native.fileStamp,
    setTitle(title) {
      void native.setTitle(title).catch(() => undefined);
    },
    openUrl: native.openUrl,
    async ask(text, buttons) {
      const [first, second, third] = buttons;
      const answer = await message(text, {
        title: "lookdown",
        kind: "warning",
        buttons: third === undefined ? { ok: first, cancel: second } : { yes: first, no: second, cancel: third },
      });
      return buttonIndex(answer, buttons);
    },
    onCloseRequested(cb) {
      void getCurrentWindow().onCloseRequested(async (event) => {
        let close = false;
        try {
          close = await cb();
        } catch {
          close = false;
        }
        if (!close) event.preventDefault();
      });
    },
    onFocus(cb) {
      void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) cb();
      });
    },
  };
}
