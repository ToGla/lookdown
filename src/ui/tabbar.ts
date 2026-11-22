// The tab strip: plain DOM, rebuilt from the app's model on each change.

export interface TabModel {
  id: number;
  label: string;
  /** Full path, shown on hover. */
  path: string;
  /** "•" unsaved, "!" pending change on disk, "" none. */
  marker: "" | "•" | "!";
}

export interface TabBarHandlers {
  select(id: number): void;
  close(id: number): void;
}

export function createTabBar(
  container: HTMLElement,
  handlers: TabBarHandlers,
): { render(tabs: readonly TabModel[], activeId: number | null): void } {
  container.classList.add("ld-tabbar");
  container.setAttribute("role", "tablist");

  // A vertical wheel scrolls the strip sideways.
  container.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY === 0 || e.deltaX !== 0) return;
      container.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );

  return {
    render(tabs, activeId) {
      container.hidden = tabs.length === 0;
      container.replaceChildren(...tabs.map((tab) => tabElement(tab, tab.id === activeId, handlers)));
      container.querySelector(".ld-tab-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  };
}

function tabElement(tab: TabModel, active: boolean, handlers: TabBarHandlers): HTMLElement {
  const el = document.createElement("div");
  el.className = active ? "ld-tab ld-tab-active" : "ld-tab";
  el.title = tab.path;

  const select = document.createElement("button");
  select.type = "button";
  select.className = "ld-tab-select";
  select.setAttribute("role", "tab");
  select.setAttribute("aria-selected", String(active));
  const marker = document.createElement("span");
  marker.className = "ld-tab-marker";
  marker.textContent = tab.marker;
  const label = document.createElement("span");
  label.className = "ld-tab-label";
  label.textContent = tab.label;
  select.append(marker, label);
  select.addEventListener("click", () => handlers.select(tab.id));

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ld-tab-close";
  close.textContent = "×";
  close.setAttribute("aria-label", `Close ${tab.label}`);
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.close(tab.id);
  });

  // Keep the editor's focus when clicking the strip; block middle-click autoscroll.
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    handlers.close(tab.id);
  });

  el.append(select, close);
  return el;
}
