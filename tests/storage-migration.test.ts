import { beforeEach, describe, expect, it, vi } from "vitest";

describe("local storage migration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("splits the legacy queue into pending work and code-free history", async () => {
    const stored: Record<string, any> = {
      queue: [
        { id: "pending", status: "blocked", code: "secret", acceptedAt: "2026-08-17T00:00:00Z" },
        { id: "done", status: "synced", code: undefined, acceptedAt: "2026-08-16T00:00:00Z" },
      ],
      dailyPulls: {
        "2026-08-16": {
          date: "2026-08-16",
          compactDate: "260816",
          branch: "260816",
          number: 16,
          nodeId: "PR_node",
          url: "https://example.test/pull/16",
          draft: true,
        },
      },
    };
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({ ...stored })),
          set: vi.fn(async (updates: Record<string, unknown>) => Object.assign(stored, updates)),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
          }),
        },
      },
    };
    const { getPendingQueue, getPullSnapshots, getSyncHistory } = await import("../src/background/storage");

    const [queue, history, pulls] = await Promise.all([
      getPendingQueue(), getSyncHistory(), getPullSnapshots(),
    ]);

    expect(queue).toEqual([expect.objectContaining({ id: "pending", code: "secret", status: "blocked" })]);
    expect(history).toEqual([expect.objectContaining({ id: "done", status: "synced", syncedAt: "2026-08-16T00:00:00Z" })]);
    expect(history[0]).not.toHaveProperty("code");
    expect(pulls["2026-08-16"]).toMatchObject({ state: "draft" });
    expect(stored).not.toHaveProperty("queue");
    expect(stored).not.toHaveProperty("dailyPulls");
  });
});
