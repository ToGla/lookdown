// Frontend entry point: the app shell over the Tauri host.

import { startApp } from "./app";
import { tauriHost } from "./host";

function element(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

startApp({ tabs: element("#tabs"), app: element("#app"), status: element("#status") }, tauriHost());
