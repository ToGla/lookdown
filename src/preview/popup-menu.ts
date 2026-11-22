import type { EditorView } from "@codemirror/view";

export interface MenuItem {
  label: string;
  disabled: boolean;
  run: (view: EditorView) => void;
}

let closeCurrent: (() => void) | null = null;

export function openMenu(view: EditorView, items: MenuItem[], x: number, y: number): void {
  closeCurrent?.();
  const menu = document.createElement("div");
  menu.className = "cm-ld-menu";
  menu.setAttribute("role", "menu");
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    b.disabled = item.disabled;
    b.addEventListener("click", () => {
      close();
      item.run(view);
    });
    menu.append(b);
    buttons.push(b);
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      view.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const enabled = buttons.filter((b) => !b.disabled);
    if (!enabled.length) return;
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    enabled[(i + step + enabled.length) % enabled.length].focus();
  };
  const onPointerDown = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onDismiss = () => close();
  function close() {
    menu.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", onDismiss, true);
    window.removeEventListener("blur", onDismiss);
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
  document.body.append(menu);
  const margin = 4;
  const left = Math.max(margin, Math.min(x, window.innerWidth - menu.offsetWidth - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - menu.offsetHeight - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", onDismiss, true);
  window.addEventListener("blur", onDismiss);
  buttons.find((b) => !b.disabled)?.focus();
}
