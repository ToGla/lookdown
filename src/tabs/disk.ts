export type Stamp = { modifiedMs: number; size: number };
export type DiskEvent = "unchanged" | "changed" | "deleted" | "returned";
export type DiskAction = "none" | "reload" | "show-changed" | "show-deleted";

function same(a: Stamp, b: Stamp): boolean {
  return a.modifiedMs === b.modifiedMs && a.size === b.size;
}

/** known = stamp lookdown last read or wrote (null = missing); now = current. */
export function compareStamp(known: Stamp | null, now: Stamp | null): DiskEvent {
  if (!known) return now ? "returned" : "unchanged";
  if (!now) return "deleted";
  return same(known, now) ? "unchanged" : "changed";
}

export function diskAction(
  event: DiskEvent,
  dirty: boolean,
  dismissedStamp: Stamp | null,
  now: Stamp | null,
): DiskAction {
  if (event === "unchanged") return "none";
  if (event === "deleted") return "show-deleted";
  if (!dirty) return "reload";
  if (dismissedStamp && now && same(dismissedStamp, now)) return "none";
  return "show-changed";
}

/** True when the disk differs from what lookdown last saw, so a save must ask first. */
export function needsOverwriteConfirm(known: Stamp | null, now: Stamp | null): boolean {
  if (!now) return false;
  return compareStamp(known, now) !== "unchanged";
}
