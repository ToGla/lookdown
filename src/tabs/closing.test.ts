import { describe, expect, it, vi } from "vitest";
import { closeAll, type Choice } from "./closing";

const tabs = (...d: boolean[]) => d.map((dirty, i) => ({ id: i + 1, dirty }));

describe("closeAll", () => {
  it("closes without asking when nothing is dirty", async () => {
    const ask = vi.fn();
    expect(await closeAll(tabs(false, false), ask, vi.fn())).toEqual({ close: true });
    expect(ask).not.toHaveBeenCalled();
  });
  it("asks once with dirty ids in tab order; cancel keeps the window", async () => {
    const ask = vi.fn(async (): Promise<Choice> => "cancel");
    expect(await closeAll(tabs(true, false, true), ask, vi.fn())).toEqual({ close: false, activate: null });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith([1, 3]);
  });
  it("discard closes without saving", async () => {
    const save = vi.fn();
    expect(await closeAll(tabs(true), async () => "discard", save)).toEqual({ close: true });
    expect(save).not.toHaveBeenCalled();
  });
  it("save saves each dirty tab in order, then closes", async () => {
    const order: number[] = [];
    const save = vi.fn(async (id: number) => (order.push(id), true));
    expect(await closeAll(tabs(true, false, true), async () => "save", save)).toEqual({ close: true });
    expect(order).toEqual([1, 3]);
  });
  it("stops at the first failed save and activates that tab", async () => {
    const save = vi.fn(async (id: number) => id !== 2);
    const r = await closeAll(tabs(true, true, true), async () => "save", save);
    expect(r).toEqual({ close: false, activate: 2 });
    expect(save.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });
});
