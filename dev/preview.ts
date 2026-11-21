// Browser harness: mounts the editor on dev/sample.md without Tauri.
import { createEditor } from "../src/editor";
import sample from "./sample.md?raw";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

// Images come from the Vite server: /dev/sample.md resolves ./images/x.png to /dev/images/x.png.
async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path, { headers: { Accept: "image/*" } });
  // Vite may answer a missing file with its HTML fallback, so check the type too.
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`${res.status} ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

const view = createEditor(app, sample, {
  onUpdate: () => {},
  onSave: () => {},
  openUrl: (url) => console.log("openUrl", url),
  docPath: "/dev/sample.md",
  imageIO: {
    size: async (path) => (await fetchBytes(path)).byteLength,
    read: fetchBytes,
  },
});
view.focus();
