import { describe, expect, it } from "vitest";

import { PendingWorkCoordinator } from "../src/background/pending-work-lock";

describe("pending work mutation serialization", () => {
  it("stores an admitted capture before processing its immediate acceptance", async () => {
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
    const acceptance = coordinator.transition(async () => {
      order.push("acceptance-inspected");
    });
    await Promise.resolve();

    expect(order).toEqual(["sync-start", "editor-read"]);
    finishSync();
    await Promise.all([sync, capture, acceptance]);
    expect(order).toEqual([
      "sync-start",
      "editor-read",
      "sync-finish",
      "stored:captured-source",
      "acceptance-inspected",
    ]);
  });

  it("starts multiple editor reads immediately while sync is still running", async () => {
    const coordinator = new PendingWorkCoordinator();
    const order: string[] = [];
    let finishSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { finishSync = resolve; });

    const sync = coordinator.mutate(async () => {
      order.push("sync-start");
      await syncGate;
      order.push("sync-finish");
    });
    const first = coordinator.capture(
      async () => { order.push("editor-read:first"); return "first"; },
      async (source) => { order.push(`stored:${source}`); },
    );
    const second = coordinator.capture(
      async () => { order.push("editor-read:second"); return "second"; },
      async (source) => { order.push(`stored:${source}`); },
    );
    await Promise.resolve();

    expect(order).toEqual(["sync-start", "editor-read:first", "editor-read:second"]);
    finishSync();
    await Promise.all([sync, first, second]);
    expect(order).toEqual([
      "sync-start",
      "editor-read:first",
      "editor-read:second",
      "sync-finish",
      "stored:first",
      "stored:second",
    ]);
  });

  it("commits captures on the correct side of an intervening transition", async () => {
    const coordinator = new PendingWorkCoordinator();
    const order: string[] = [];

    const first = coordinator.capture(
      async () => "first",
      async (source) => { order.push(`stored:${source}`); },
    );
    const transition = coordinator.transition(async () => {
      order.push("transition");
    });
    const second = coordinator.capture(
      async () => "second",
      async (source) => { order.push(`stored:${source}`); },
    );

    await Promise.all([first, transition, second]);
    expect(order).toEqual(["stored:first", "transition", "stored:second"]);
  });
});
