import { beforeEach, describe, expect, it, vi } from "vitest";

import { closePastDrafts, refreshTodayPull } from "../src/background/sync";
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

describe("today pull refresh", () => {
  it("fetches today's managed pull and caches its live state", async () => {
    const live = {
      ...record,
      date: "2026-08-17",
      compactDate: "260817",
      branch: "260817",
      number: 17,
      draft: false,
    };
    const client = { findManagedOpenPull: vi.fn(async () => live) };
    const pulls: Record<string, DailyPullRequest> = {};

    await expect(refreshTodayPull(
      auth,
      client as any,
      pulls,
      new Date("2026-08-17T01:00:00+09:00"),
    )).resolves.toEqual({ date: "2026-08-17", pull: live });
    expect(client.findManagedOpenPull).toHaveBeenCalledWith("ada", "260817", "2026-08-17");
    expect(pulls["2026-08-17"]).toEqual(live);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ dailyPulls: pulls });
  });

  it("removes a stale cached record when today's pull no longer exists", async () => {
    const client = { findManagedOpenPull: vi.fn(async () => undefined) };
    const pulls = {
      "2026-08-17": { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817" },
    };

    await refreshTodayPull(auth, client as any, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(pulls["2026-08-17"]).toBeUndefined();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ dailyPulls: pulls });
  });

  it("does not rewrite storage when today's cached record is current", async () => {
    const live = { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817" };
    const client = { findManagedOpenPull: vi.fn(async () => live) };
    const pulls = { "2026-08-17": { ...live } };

    await refreshTodayPull(auth, client as any, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
