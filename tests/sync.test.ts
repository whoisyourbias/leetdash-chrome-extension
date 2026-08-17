import { beforeEach, describe, expect, it, vi } from "vitest";

import { moveCompletedToHistory, pollPullRequests, refreshTodayPull } from "../src/background/sync";
import type { AuthState, DailyPullRequest, SubmissionQueueItem, SyncHistoryItem } from "../src/shared/model";

const auth: AuthState = { login: "ada", token: "token" };
const record: DailyPullRequest = {
  date: "2026-08-16",
  compactDate: "260816",
  branch: "260816",
  number: 16,
  nodeId: "PR_node",
  url: "https://github.com/whoisyourbias/leetdash/pull/16",
  state: "draft",
};

beforeEach(() => {
  (globalThis as any).chrome = {
    storage: { local: { set: vi.fn(async () => {}) } },
  };
});

describe("GitHub pull polling", () => {
  it("does not mark a past Draft ready while its pending queue contains work", async () => {
    const client = {
      findManagedPull: vi.fn(async (_login: string, _branch: string, date: string) => date === record.date ? record : undefined),
      markReady: vi.fn(),
    };
    const blocked = { date: record.date, status: "blocked" } as SubmissionQueueItem;

    await pollPullRequests(auth, client as any, [blocked], { [record.date]: record }, new Date("2026-08-17T01:00:00+09:00"));

    expect(client.markReady).not.toHaveBeenCalled();
  });

  it("marks a fully synchronized previous-day Draft ready from live GitHub state", async () => {
    const client = {
      findManagedPull: vi.fn(async (_login: string, _branch: string, date: string) => date === record.date ? record : undefined),
      markReady: vi.fn(async () => {}),
    };
    const pulls = { [record.date]: { ...record } };

    await pollPullRequests(auth, client as any, [], pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(client.markReady).toHaveBeenCalledWith("PR_node");
    expect(pulls[record.date]).toBeUndefined();
  });

  it("keeps a previous-day Draft when automatic Ready transition is disabled", async () => {
    const client = {
      findManagedPull: vi.fn(async (_login: string, _branch: string, date: string) => date === record.date ? record : undefined),
      markReady: vi.fn(),
    };
    const pulls = { [record.date]: { ...record } };

    await pollPullRequests(auth, client as any, [], pulls, new Date("2026-08-17T01:00:00+09:00"), false);

    expect(client.markReady).not.toHaveBeenCalled();
    expect(pulls[record.date].state).toBe("draft");
  });

  it("automatically releases only pull-related blocked work after a Draft is reopened", async () => {
    const reopened = { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817", number: 17 };
    const client = { findManagedPull: vi.fn(async () => reopened), markReady: vi.fn() };
    const queue = [
      { date: "2026-08-17", status: "blocked", blockReason: "pull_closed", error: "closed" },
      { date: "2026-08-17", status: "blocked", error: "catalog" },
    ] as SubmissionQueueItem[];
    const pulls = {
      "2026-08-17": { ...reopened, state: "closed" as const },
    };

    await pollPullRequests(auth, client as any, queue, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(queue[0]).toMatchObject({ status: "pending", error: undefined, blockReason: undefined });
    expect(queue[1]).toMatchObject({ status: "blocked", error: "catalog" });
    expect(pulls["2026-08-17"].state).toBe("draft");
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pendingQueue: queue });
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
      state: "ready" as const,
    };
    const client = { findManagedPull: vi.fn(async () => live) };
    const pulls: Record<string, DailyPullRequest> = {};

    await expect(refreshTodayPull(
      auth,
      client as any,
      pulls,
      new Date("2026-08-17T01:00:00+09:00"),
    )).resolves.toEqual({ date: "2026-08-17", pull: live });
    expect(client.findManagedPull).toHaveBeenCalledWith("ada", "260817", "2026-08-17");
    expect(pulls["2026-08-17"]).toEqual(live);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pullSnapshots: pulls });
  });

  it("removes a stale cached record when today's pull no longer exists", async () => {
    const client = { findManagedPull: vi.fn(async () => undefined) };
    const pulls = {
      "2026-08-17": { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817" },
    };

    await refreshTodayPull(auth, client as any, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(pulls["2026-08-17"]).toBeUndefined();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pullSnapshots: pulls });
  });

  it("does not rewrite storage when the cached GitHub state is unchanged", async () => {
    const live = { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817" };
    const client = { findManagedPull: vi.fn(async () => ({ ...live })) };
    const pulls = { "2026-08-17": { ...live } };

    await refreshTodayPull(auth, client as any, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("pending queue completion", () => {
  it("removes synchronized work from the code-bearing queue and retains only code-free history", () => {
    const queue = [{ id: "submission", code: "secret", status: "syncing" }] as SubmissionQueueItem[];
    const history: SyncHistoryItem[] = [];
    const completed = { id: "submission", status: "synced", syncedAt: "2026-08-17T01:00:00Z" } as SyncHistoryItem;

    moveCompletedToHistory(queue, 0, history, completed);

    expect(queue).toEqual([]);
    expect(history).toEqual([completed]);
    expect(history[0]).not.toHaveProperty("code");
  });
});
