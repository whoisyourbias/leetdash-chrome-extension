import { describe, expect, it } from "vitest";

import { PendingWorkLock } from "../src/background/pending-work-lock";

describe("pending work mutation serialization", () => {
  it("does not let logout inspect storage until an in-flight capture finishes", async () => {
    const lock = new PendingWorkLock();
    const order: string[] = [];
    let finishCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => { finishCapture = resolve; });

    const capture = lock.run(async () => {
      order.push("capture-start");
      await captureGate;
      order.push("capture-stored");
    });
    const logout = lock.run(async () => { order.push("logout-inspected"); });
    await Promise.resolve();

    expect(order).toEqual(["capture-start"]);
    finishCapture();
    await Promise.all([capture, logout]);
    expect(order).toEqual(["capture-start", "capture-stored", "logout-inspected"]);
  });
});
