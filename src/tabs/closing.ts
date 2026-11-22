export type Choice = "save" | "discard" | "cancel";
export interface ClosingTab {
  id: number;
  dirty: boolean;
}

export async function closeAll(
  tabs: ClosingTab[],
  ask: (dirtyIds: number[]) => Promise<Choice>,
  save: (id: number) => Promise<boolean>,
): Promise<{ close: true } | { close: false; activate: number | null }> {
  const dirtyIds = tabs.filter((t) => t.dirty).map((t) => t.id);
  if (dirtyIds.length === 0) return { close: true };
  const choice = await ask(dirtyIds);
  if (choice === "cancel") return { close: false, activate: null };
  if (choice === "discard") return { close: true };
  for (const id of dirtyIds) {
    if (!(await save(id))) return { close: false, activate: id };
  }
  return { close: true };
}
