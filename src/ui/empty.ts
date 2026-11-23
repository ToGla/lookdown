// The page shown when no tab is open.

export function emptyText(isMac: boolean): string {
  const mod = isMac ? "⌘" : "Ctrl+";
  return `Create a file with ${mod}N, open one with ${mod}O, or drop one here.`;
}

export function createEmptyPage(parent: HTMLElement, isMac: boolean): { show(visible: boolean): void } {
  const page = document.createElement("div");
  page.className = "ld-empty";
  page.textContent = emptyText(isMac);
  page.hidden = true;
  parent.append(page);
  return {
    show(visible) {
      page.hidden = !visible;
    },
  };
}
