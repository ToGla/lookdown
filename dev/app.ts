// Browser harness for the whole app shell: startApp over an in-memory fake host.
//
// Open /dev/app.html (Vite dev server). Startup paths come from `?open=a,b`
// (default /dev/sample.md; `?open=` for the empty window). The page exposes
// `window.__devHost` to drive it from the console or a test browser:
//   __devHost.files()                 list fake files
//   __devHost.read(path)              a fake file's text
//   __devHost.edit(path, text)        change (or create) a file "on disk"
//   __devHost.remove(path)            delete a file "on disk"
//   __devHost.focus()                 fire the window-focus event
//   __devHost.queue(...paths)         a second launch with these paths
//   __devHost.drop(...paths)          drop these files on the window
//   __devHost.requestClose()          the window's close button; resolves true if it would close
//   __devHost.host                    the FakeHost itself (titles, writes, asked, ...)

import { startApp } from "../src/app";
import { FakeHost } from "../src/test-host";
import sample from "./sample.md?raw";

// Images come from the Vite server: /dev/sample.md resolves ./images/x.png to /dev/images/x.png.
async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path, { headers: { Accept: "image/*" } });
  // Vite may answer a missing file with its HTML fallback, so check the type too.
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`${res.status} ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

class BrowserHost extends FakeHost {
  override async readFile(path: string): Promise<Uint8Array> {
    if (this.files.has(path) || this.readErrors.has(path) || !/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(path)) {
      return super.readFile(path);
    }
    return fetchBytes(path);
  }

  override async fileSize(path: string): Promise<number> {
    return (await this.readFile(path)).byteLength;
  }

  override async pickFiles(): Promise<string[]> {
    this.calls.push("pickFiles");
    const files = [...this.files.keys()].join("\n");
    const answer = window.prompt(`Open which file(s)? Separate several with ";".\n\n${files}`, "/dev/work/notes.md");
    return (answer ?? "")
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p !== "");
  }

  override ask(message: string, buttons: [string, string, string?]): Promise<0 | 1 | 2> {
    this.asked.push({ message, buttons });
    return askDialog(message, buttons);
  }

  override setTitle(title: string): void {
    super.setTitle(title);
    document.title = title;
  }

  override async openUrl(url: string): Promise<void> {
    await super.openUrl(url);
    console.log("openUrl", url);
  }
}

/** A tiny modal standing in for the native message dialog. */
function askDialog(message: string, buttons: [string, string, string?]): Promise<0 | 1 | 2> {
  const labels = buttons.filter((b): b is string => b !== undefined);
  const last = (labels.length - 1) as 1 | 2;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dev-ask";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgb(0 0 0 / 30%)";
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.style.cssText =
      "background:Canvas;color:CanvasText;padding:1rem 1.25rem;border-radius:6px;box-shadow:0 4px 16px rgb(0 0 0 / 35%);max-width:28rem";
    const text = document.createElement("p");
    text.style.cssText = "white-space:pre-line;margin:0 0 1rem";
    text.textContent = message;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:0.5rem;justify-content:flex-end";
    const done = (i: 0 | 1 | 2) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(i);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      done(last);
    };
    labels.forEach((label, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => done(i as 0 | 1 | 2));
      row.append(button);
    });
    box.append(text, row);
    overlay.append(box);
    document.body.append(overlay);
    window.addEventListener("keydown", onKey, true);
    (row.firstElementChild as HTMLElement | null)?.focus();
  });
}

const host = new BrowserHost();
host.isMac = /Mac/i.test(navigator.userAgent);
host.caseInsensitivePaths = /Windows/i.test(navigator.userAgent);
host.setFile("/dev/sample.md", sample);
host.setFile("/dev/work/notes.md", "# Work notes\n\n- [ ] Ship tabs\n- [x] Write the plan\n");
host.setFile("/dev/home/notes.md", "# Home notes\n\nSame file name as the work notes, other folder.\n");
host.setFile("/dev/latin1.md", new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a])); // "café" in Latin-1: not UTF-8

const open = new URLSearchParams(location.search).get("open");
host.queued = (open ?? "/dev/sample.md").split(",").filter((p) => p !== "");

const devHost = {
  host,
  files: () => [...host.files.keys()],
  read: (path: string) => host.text(path),
  edit: (path: string, text: string) => host.setFile(path, text),
  remove: (path: string) => host.deleteFile(path),
  focus: () => host.focus(),
  queue: (...paths: string[]) => host.queuePaths(...paths),
  drop: (...paths: string[]) => host.dropFiles(...paths),
  requestClose: () => host.requestClose(),
};
(window as unknown as { __devHost: typeof devHost }).__devHost = devHost;

function element(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

startApp({ tabs: element("#tabs"), app: element("#app"), status: element("#status") }, host);
