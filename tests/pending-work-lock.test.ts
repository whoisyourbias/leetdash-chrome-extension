import { describe, expect, it } from "vitest";

import { PendingWorkCoordinator } from "../src/background/pending-work-lock";

describe("pending work mutation serialization", () => {
  it("reads a submission during sync, stores it afterward, then lets a transition inspect", async () => {
    const coordinator = new PendingWorkCoordinator();
    const order: string[] = [];
    let finishSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { finishSync = resolve; });

    const sync = coordinator.mutate(async () => {
      order.push("sync-start");
      await syncGate;
      order.push("sync-finish");
    });
    const capture = coordinator.capture(
      async () => {
        order.push("editor-read");
        return "captured-source";
      },
      async (source) => { order.push(`stored:${source}`); },
    );
    const transition = coordinator.transition(async () => {
      order.push("transition-inspected");
    });
    await Promise.resolve();

    expect(order).toEqual(["sync-start", "editor-read"]);
    finishSync();
    await Promise.all([sync, capture, transition]);
    expect(order).toEqual([
      "sync-start",
      "editor-read",
      "sync-finish",
      "stored:captured-source",
      "transition-inspected",
    ]);
  });
});
