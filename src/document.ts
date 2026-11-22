// One open file: its on-disk base text, the editor changes made since, and
// saving. Saving rebuilds bytes from the base so untouched bytes never change.

import { Annotation, ChangeSet, Text, type Transaction } from "@codemirror/state";
import { decode, encode } from "./file/codec";
import { type Base, makeBase, normalized, rebuild } from "./file/lines";

export type Writer = (path: string, bytes: Uint8Array) => Promise<void>;

/** Marks a transaction that loads on-disk text into the editor; not a user edit. */
export const reloadAnnotation = Annotation.define<true>();

export class OpenDocument {
  /** The text on disk (normalized), matching `base`. */
  private savedDoc: Text;
  /** The editor's current text. */
  private current: Text;
  /** Changes from `pendingFrom` to `current`. */
  private pending: ChangeSet;
  /** `savedDoc`, or the text being written while a save runs. */
  private pendingFrom: Text;
  /** The last save started, until it settles; saves run one at a time. */
  private running: Promise<void> | null = null;
  private isMissing = false;

  private constructor(
    readonly path: string,
    private base: Base,
    private bom: boolean,
  ) {
    this.savedDoc = Text.of(normalized(base).split("\n"));
    this.current = this.savedDoc;
    this.pendingFrom = this.savedDoc;
    this.pending = ChangeSet.empty(this.savedDoc.length);
  }

  static fromBytes(path: string, bytes: Uint8Array): OpenDocument | { error: string } {
    const result = decode(bytes);
    if (!result.ok) return { error: result.error };
    return new OpenDocument(path, makeBase(result.text), result.bom);
  }

  /** The text to load into the editor. */
  get initialText(): string {
    return this.savedDoc.toString();
  }

  /** True once the file vanished from disk; cleared by a save or reload. */
  get missing(): boolean {
    return this.isMissing;
  }

  markMissing(): void {
    this.isMissing = true;
  }

  /**
   * Replace the document with new on-disk bytes (the editor is loaded with the
   * returned text via a reload-annotated transaction). If a save is running, the
   * replacement is applied after it settles so the save cannot overwrite it.
   */
  reload(bytes: Uint8Array): { text: string } | { error: string } {
    const result = decode(bytes);
    if (!result.ok) return { error: result.error };
    const apply = () => {
      this.base = makeBase(result.text);
      this.bom = result.bom;
      this.savedDoc = Text.of(normalized(this.base).split("\n"));
      this.current = this.savedDoc;
      this.pendingFrom = this.savedDoc;
      this.pending = ChangeSet.empty(this.savedDoc.length);
      this.isMissing = false;
    };
    if (this.running) {
      void this.running.then(apply);
      return { text: Text.of(normalized(makeBase(result.text)).split("\n")).toString() };
    }
    apply();
    return { text: this.savedDoc.toString() };
  }

  /** Call for every editor transaction. */
  track(tr: Transaction): void {
    if (tr.annotation(reloadAnnotation)) return;
    if (!tr.docChanged) return;
    this.current = tr.newDoc;
    this.pending = this.pending.compose(tr.changes);
    // Back at the starting text (e.g. after undo): drop the round trip so
    // re-inserted line breaks never replace their original endings.
    const from = this.pendingFrom;
    if (tr.newDoc.length === from.length && tr.newDoc.eq(from)) {
      this.pending = ChangeSet.empty(from.length);
    }
  }

  isDirty(): boolean {
    return this.isMissing || !this.current.eq(this.savedDoc);
  }

  /**
   * Write the current text, after any save already running. Rejects with the
   * writer's error, leaving the document dirty and its tracking intact.
   */
  save(write: Writer): Promise<"saved" | "clean"> {
    // Start at once when idle, so the text saved is the text at the keypress.
    const running = this.running;
    const run = running ? running.then(() => this.saveNow(write)) : this.saveNow(write);
    const settled: Promise<void> = run.then(
      () => undefined,
      () => undefined,
    );
    this.running = settled;
    void settled.then(() => {
      if (this.running === settled) this.running = null;
    });
    return run;
  }

  private async saveNow(write: Writer): Promise<"saved" | "clean"> {
    if (!this.isDirty()) return "clean";
    const doc = this.current;
    const changes = this.pending;
    const raw = rebuild(this.base, changes);
    // Edits made while the write runs are tracked relative to `doc`.
    this.pending = ChangeSet.empty(doc.length);
    this.pendingFrom = doc;
    try {
      await write(this.path, encode(raw, this.bom));
    } catch (error) {
      this.pending = changes.compose(this.pending);
      this.pendingFrom = this.savedDoc;
      // Edits during the write may have restored the saved text.
      if (this.current.eq(this.savedDoc)) this.pending = ChangeSet.empty(this.savedDoc.length);
      throw error;
    }
    this.base = makeBase(raw);
    this.savedDoc = doc;
    this.isMissing = false;
    return "saved";
  }
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function windowTitle(path: string, dirty: boolean): string {
  return `${dirty ? "• " : ""}${basename(path)} — lookdown`;
}
