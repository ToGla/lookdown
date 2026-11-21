// Browser harness: mounts the editor on dev/sample.md without Tauri.
import { createEditor } from "../src/editor";
import sample from "./sample.md?raw";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");
const view = createEditor(app, sample, () => {}, () => {}, () => {});
view.focus();
