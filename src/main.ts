// Frontend entry point: open the startup file, edit it, save with Mod-s.

import { OpenDocument, basename, windowTitle } from "./document";
import { createEditor } from "./editor";
import { initialPath, readFile, setTitle, writeFile } from "./native";

const app = document.querySelector<HTMLElement>("#app")!;
const status = document.querySelector<HTMLElement>("#status")!;

function showStatus(message: string): void {
  status.textContent = message;
  status.hidden = message === "";
}

async function start(): Promise<void> {
  showStatus("");
  const path = await initialPath();
  if (!path) {
    showStatus("No file open. Start lookdown with a file: lookdown notes.md");
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    showStatus(`Could not open ${path}: ${String(error)}`);
    return;
  }
  const doc = OpenDocument.fromBytes(path, bytes);
  if ("error" in doc) {
    showStatus(`${basename(path)}: ${doc.error}`);
    return;
  }

  let shownDirty = false;
  const refreshTitle = () => {
    const dirty = doc.isDirty();
    if (dirty === shownDirty) return;
    shownDirty = dirty;
    void setTitle(windowTitle(path, dirty));
  };
  void setTitle(windowTitle(path, false));

  const save = async () => {
    try {
      await doc.save(writeFile);
      showStatus("");
    } catch (error) {
      showStatus(`Could not save: ${String(error)}`);
    }
    refreshTitle();
  };

  const view = createEditor(
    app,
    doc.initialText,
    (update) => {
      for (const tr of update.transactions) doc.track(tr);
      if (update.docChanged) refreshTitle();
    },
    () => void save(),
  );
  view.focus();
}

void start();
