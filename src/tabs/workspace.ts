import { baseName, parentName, parentPath, pathKey } from "./paths";

export interface TabInfo {
  id: number;
  path: string;
}

export class Workspace<T extends TabInfo> {
  private list: T[] = [];
  private activeId: number | null = null;

  constructor(private readonly caseInsensitive: boolean) {}

  get tabs(): readonly T[] {
    return this.list;
  }

  get active(): T | null {
    return this.list.find((t) => t.id === this.activeId) ?? null;
  }

  find(path: string): T | null {
    const key = pathKey(path, this.caseInsensitive);
    return this.list.find((t) => pathKey(t.path, this.caseInsensitive) === key) ?? null;
  }

  add(tab: T): void {
    const at = this.list.findIndex((t) => t.id === this.activeId);
    this.list.splice(at < 0 ? this.list.length : at + 1, 0, tab);
    this.activeId = tab.id;
  }

  activate(id: number): void {
    if (this.list.some((t) => t.id === id)) this.activeId = id;
  }

  remove(id: number): void {
    const i = this.list.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (this.activeId !== id) return;
    const next = this.list[i] ?? this.list[i - 1];
    this.activeId = next ? next.id : null;
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  private step(d: number): void {
    const n = this.list.length;
    if (n < 2) return;
    const i = this.list.findIndex((t) => t.id === this.activeId);
    if (i < 0) return;
    this.activeId = this.list[(i + d + n) % n].id;
  }

  label(tab: T): string {
    const fold = (s: string) => (this.caseInsensitive ? s.toLowerCase() : s);
    const name = baseName(tab.path);
    const same = this.list.filter((t) => t !== tab && fold(baseName(t.path)) === fold(name));
    if (same.length === 0) return name;
    const parent = parentName(tab.path);
    const clash = same.some((t) => fold(parentName(t.path)) === fold(parent));
    return `${name} — ${clash ? parentPath(tab.path) : parent}`;
  }
}
