import { beforeEach, describe, expect, it, vi } from "vitest";

import { closePastDrafts } from "../src/background/sync";
import type { AuthState, DailyPullRequest, SubmissionQueueItem } from "../src/shared/model";

const auth: AuthState = { login: "ada", token: "token" };
const record: DailyPullRequest = {
  date: "2026-08-16",
  compactDate: "260816",
  branch: "260816",
  number: 16,
  nodeId: "PR_node",
  url: "https://github.com/whoisyourbias/leetdash/pull/16",
  draft: true,
};

beforeEach(() => {
  (globalThis as any).chrome = {
    storage: { local: { set: vi.fn(async () => {}) } },
  };
});

describe("past Draft reconciliation", () => {
  it("does not close a day while a blocked submission still contains unsynchronized work", async () => {
    const client = {
      getPull: vi.fn(),
      markReady: vi.fn(),
    };
    const blocked = {
      date: "2026-08-16",
      status: "blocked",
    } as SubmissionQueueItem;
    await closePastDrafts(auth, client as any, [blocked], { "2026-08-16": record }, new Date("2026-08-17T01:00:00+09:00"));
    expect(client.getPull).not.toHaveBeenCalled();
    expect(client.markReady).not.toHaveBeenCalled();
  });

  it("marks a fully synchronized previous-day Draft ready", async () => {
    const client = {
      getPull: vi.fn(async () => ({ state: "open", draft: true, node_id: "PR_live" })),
      markReady: vi.fn(async () => {}),
    };
    const pulls = { "2026-08-16": { ...record } };
    await closePastDrafts(auth, client as any, [], pulls, new Date("2026-08-17T01:00:00+09:00"));
    expect(client.markReady).toHaveBeenCalledWith("PR_live");
    expect(pulls["2026-08-16"].draft).toBe(false);
  });

  it("keeps a previous-day Draft when automatic Ready transition is disabled", async () => {
    const client = {
      getPull: vi.fn(),
      markReady: vi.fn(),
    };
    const pulls = { "2026-08-16": { ...record } };

    await closePastDrafts(
      auth,
      client as any,
      [],
      pulls,
      new Date("2026-08-17T01:00:00+09:00"),
      false,
    );

    expect(client.getPull).not.toHaveBeenCalled();
    expect(client.markReady).not.toHaveBeenCalled();
    expect(pulls["2026-08-16"].draft).toBe(true);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
