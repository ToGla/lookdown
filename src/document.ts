// One open file: its on-disk base text, the editor changes made since, and
// saving. Saving rebuilds bytes from the base so untouched bytes never change.

import { ChangeSet, Text, type Transaction } from "@codemirror/state";
import { decode, encode } from "./file/codec";
import { type Base, makeBase, normalized, rebuild } from "./file/lines";

export type Writer = (path: string, bytes: Uint8Array) => Promise<void>;

export class OpenDocument {
  /** Changes from `normalized(base)` to the current editor text. */
  private pending: ChangeSet;
  private savedDoc: Text;

  private constructor(
    readonly path: string,
    private base: Base,
    private readonly bom: boolean,
  ) {
    this.savedDoc = Text.of(normalized(base).split("\n"));
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

  /** Call for every editor transaction. */
  track(tr: Transaction): void {
    if (!tr.docChanged) return;
    this.pending = this.pending.compose(tr.changes);
    // Back at the saved text (e.g. after undo): drop the round trip so
    // re-inserted line breaks never replace their original endings.
    if (tr.newDoc.length === this.savedDoc.length && tr.newDoc.eq(this.savedDoc)) {
      this.pending = ChangeSet.empty(this.savedDoc.length);
    }
  }

  isDirty(doc: Text): boolean {
    return !doc.eq(this.savedDoc);
  }

  /** Write the current text. Rejects with the writer's error, changing nothing. */
  async save(doc: Text, write: Writer): Promise<"saved" | "clean"> {
    if (!this.isDirty(doc)) return "clean";
    const changes = this.pending;
    const raw = rebuild(this.base, changes);
    // Edits made while the write runs are tracked relative to `doc`.
    this.pending = ChangeSet.empty(doc.length);
    try {
      await write(this.path, encode(raw, this.bom));
    } catch (error) {
      this.pending = changes.compose(this.pending);
      throw error;
    }
    this.base = makeBase(raw);
    this.savedDoc = doc;
    return "saved";
  }
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function windowTitle(path: string, dirty: boolean): string {
  return `${dirty ? "• " : ""}${basename(path)} — lookdown`;
}
