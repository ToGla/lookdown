import { WidgetType } from "@codemirror/view";

export class BulletWidget extends WidgetType {
  readonly name = "bullet";
  eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-ld-bullet";
    el.textContent = "•";
    return el;
  }
}

export class RuleWidget extends WidgetType {
  readonly name = "rule";
  eq(other: WidgetType): boolean {
    return other instanceof RuleWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("hr");
    el.className = "cm-ld-rule";
    return el;
  }
}

export class CheckboxWidget extends WidgetType {
  readonly name = "checkbox";
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: WidgetType): boolean {
    return other instanceof CheckboxWidget && other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.className = "cm-ld-task";
    el.checked = this.checked;
    el.dataset.pos = String(this.pos);
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export class EmptyCellWidget extends WidgetType {
  readonly name = "empty-cell";
  eq(other: WidgetType): boolean {
    return other instanceof EmptyCellWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-ld-cell";
    return el;
  }
}

/** An image inside a grid-table cell: its alt text in a small chip, keeping the grid intact. */
export class ImageChipWidget extends WidgetType {
  readonly name = "image-chip";
  constructor(readonly alt: string) {
    super();
  }
  eq(other: WidgetType): boolean {
    return other instanceof ImageChipWidget && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-ld-image-chip";
    el.textContent = `🖼 ${this.alt}`;
    return el;
  }
}
