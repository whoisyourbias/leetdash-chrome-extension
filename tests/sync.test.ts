import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyActiveProblemOverrideToQueue, applyProblemOverride, enqueueAccepted, moveCompletedToHistory, pollPullRequests, refreshTodayPull, releaseRefConflictQueueItems, releaseUnauthorizedQueueItems } from "../src/background/sync";
import { GitHubError } from "../src/background/github";
import type { ActiveProblem, AuthState, DailyPullRequest, PendingAttempt, ProblemCatalog, ProblemOverride, SubmissionQueueItem, SyncHistoryItem } from "../src/shared/model";

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
const sweaCatalog: ProblemCatalog = {
  lists: [{
    key: "swea",
    problems: [
      { provider: "swea", problemId: "2071", problemKey: "swea:2071", title: "평균값 구하기", sourceUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?problemId=2071" },
      { provider: "swea", problemId: "1204", problemKey: "swea:1204", title: "최빈수 구하기", sourceUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?problemId=1204" },
    ],
    items: [
      { problemKey: "swea:2071", submissionKey: "2071" },
      { problemKey: "swea:1204", submissionKey: "1204" },
    ],
  }],
};

function targetFor(pull: DailyPullRequest | undefined) {
  return {
    branch: pull?.branch ?? "260817",
    sequence: 1,
    pull,
    latestPull: pull,
  };
}

beforeEach(() => {
  const stored: Record<string, any> = {};
  (globalThis as any).chrome = {
    storage: { local: {
      get: vi.fn(async (keys: string | string[]) => {
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, stored[key]]));
        return keys in stored ? { [keys]: stored[keys] } : {};
      }),
      set: vi.fn(async (updates: Record<string, any>) => { Object.assign(stored, updates); }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
      }),
    } },
  };
});

describe("GitHub pull polling", () => {
  it("does not mark a past Draft ready while its pending queue contains work", async () => {
    const client = {
      resolveDailyPullTarget: vi.fn(async (_login: string, _compactDate: string, date: string) => targetFor(date === record.date ? record : undefined)),
      markReady: vi.fn(),
    };
    const blocked = { date: record.date, status: "blocked" } as SubmissionQueueItem;

    await pollPullRequests(auth, client as any, [blocked], { [record.date]: record }, new Date("2026-08-17T01:00:00+09:00"));

    expect(client.markReady).not.toHaveBeenCalled();
  });

  it("marks a fully synchronized previous-day Draft ready from live GitHub state", async () => {
    const client = {
      resolveDailyPullTarget: vi.fn(async (_login: string, _compactDate: string, date: string) => targetFor(date === record.date ? record : undefined)),
      markReady: vi.fn(async () => {}),
    };
    const pulls = { [record.date]: { ...record } };

    await pollPullRequests(auth, client as any, [], pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(client.markReady).toHaveBeenCalledWith("PR_node");
    expect(pulls[record.date]).toBeUndefined();
  });

  it("keeps a previous-day Draft when automatic Ready transition is disabled", async () => {
    const client = {
      resolveDailyPullTarget: vi.fn(async (_login: string, _compactDate: string, date: string) => targetFor(date === record.date ? record : undefined)),
      markReady: vi.fn(),
    };
    const pulls = { [record.date]: { ...record } };

    await pollPullRequests(auth, client as any, [], pulls, new Date("2026-08-17T01:00:00+09:00"), false);

    expect(client.markReady).not.toHaveBeenCalled();
    expect(pulls[record.date].state).toBe("draft");
  });

  it("automatically releases only pull-related blocked work after a Draft is reopened", async () => {
    const reopened = { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817", number: 17 };
    const client = { resolveDailyPullTarget: vi.fn(async () => targetFor(reopened)), markReady: vi.fn() };
    const queue = [
      { date: "2026-08-17", status: "blocked", blockReason: "pull_closed", error: "closed" },
      { date: "2026-08-17", status: "blocked", blockReason: "pull_merged", error: "merged" },
      { date: "2026-08-17", status: "blocked", error: "catalog" },
    ] as SubmissionQueueItem[];
    const pulls = {
      "2026-08-17": { ...reopened, state: "closed" as const },
    };

    await pollPullRequests(auth, client as any, queue, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(queue[0]).toMatchObject({ status: "pending", error: undefined, blockReason: undefined });
    expect(queue[1]).toMatchObject({ status: "pending", error: undefined, blockReason: undefined });
    expect(queue[2]).toMatchObject({ status: "blocked", error: "catalog" });
    expect(pulls["2026-08-17"].state).toBe("draft");
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pendingQueue: queue });
  });

  it("stops polling immediately when GitHub rejects the stored token", async () => {
    const client = {
      resolveDailyPullTarget: vi.fn(async () => {
        throw new GitHubError("GitHub API 401: Bad credentials", 401);
      }),
      markReady: vi.fn(),
    };

    await expect(pollPullRequests(auth, client as any, [], {}, new Date("2026-08-17T01:00:00+09:00")))
      .rejects.toMatchObject({ status: 401 });
    expect(client.resolveDailyPullTarget).toHaveBeenCalledOnce();
  });

  it("releases work blocked by a merged pull so it can use a follow-up branch", async () => {
    const merged = {
      ...record,
      state: "merged" as const,
    };
    const client = {
      resolveDailyPullTarget: vi.fn(async () => ({
        branch: "260816-2",
        sequence: 2,
        latestPull: merged,
        baseSha: "merged-head",
      })),
      markReady: vi.fn(),
    };
    const queue = [{
      date: record.date,
      status: "blocked",
      blockReason: "pull_merged",
      error: "merged",
    }] as SubmissionQueueItem[];

    await pollPullRequests(auth, client as any, queue, {}, new Date("2026-08-17T01:00:00+09:00"));

    expect(queue[0]).toMatchObject({ status: "pending", error: undefined, blockReason: undefined });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pendingQueue: queue });
  });
});

describe("expired authentication recovery", () => {
  it("releases queue items blocked by the previous 401 behavior", () => {
    const queue = [
      { status: "blocked", error: "GitHub API 401 (GET /user): Bad credentials", retryAt: undefined },
      { status: "blocked", error: "GitHub 문제 카탈로그 구조가 올바르지 않습니다." },
    ] as SubmissionQueueItem[];

    expect(releaseUnauthorizedQueueItems(queue)).toBe(true);
    expect(queue[0]).toMatchObject({ status: "pending", error: undefined });
    expect(queue[1]).toMatchObject({ status: "blocked" });
  });
});

describe("branch conflict recovery", () => {
  it("releases queue items blocked by the previous non-fast-forward behavior", () => {
    const queue = [
      {
        status: "blocked",
        error: "GitHub API 422 (PATCH /repos/ada/leetdash/git/refs/heads/260820): Update is not a fast forward",
      },
      { status: "blocked", error: "현재 문제를 leetdash 카탈로그에서 찾지 못했습니다." },
    ] as SubmissionQueueItem[];

    expect(releaseRefConflictQueueItems(queue)).toBe(true);
    expect(queue[0]).toMatchObject({ status: "pending", error: undefined });
    expect(queue[1]).toMatchObject({ status: "blocked" });
  });
});

describe("today pull refresh", () => {
  it("fetches today's managed pull and caches its live state", async () => {
    const live = {
      ...record,
      date: "2026-08-17",
      compactDate: "260817",
      branch: "260817-2",
      number: 18,
      state: "ready" as const,
    };
    const client = { resolveDailyPullTarget: vi.fn(async () => targetFor(live)) };
    const pulls: Record<string, DailyPullRequest> = {};

    await expect(refreshTodayPull(
      auth,
      client as any,
      pulls,
      new Date("2026-08-17T01:00:00+09:00"),
    )).resolves.toEqual({ date: "2026-08-17", pull: live });
    expect(client.resolveDailyPullTarget).toHaveBeenCalledWith("ada", "260817", "2026-08-17");
    expect(pulls["2026-08-17"]).toEqual(live);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pullSnapshots: pulls });
  });

  it("removes a stale cached record when today's pull no longer exists", async () => {
    const client = { resolveDailyPullTarget: vi.fn(async () => targetFor(undefined)) };
    const pulls = {
      "2026-08-17": { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817" },
    };

    await refreshTodayPull(auth, client as any, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(pulls["2026-08-17"]).toBeUndefined();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ pullSnapshots: pulls });
  });

  it("does not rewrite storage when the cached GitHub state is unchanged", async () => {
    const live = { ...record, date: "2026-08-17", compactDate: "260817", branch: "260817" };
    const client = { resolveDailyPullTarget: vi.fn(async () => targetFor({ ...live })) };
    const pulls = { "2026-08-17": { ...live } };

    await refreshTodayPull(auth, client as any, pulls, new Date("2026-08-17T01:00:00+09:00"));

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("pending queue completion", () => {
  it("applies an active problem override to matching legacy queued work immediately", () => {
    const activeProblem: ActiveProblem = {
      tabId: 1,
      pageUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
      contextKey: "swea:title:2071. 평균값 구하기",
      contextAliases: ["swea:contest:AV13zo1KAAACFAYh"],
      detected: { provider: "swea", problemId: "10", problemTitle: "2071. 평균값 구하기" },
    };
    const problemOverride: ProblemOverride = {
      provider: "swea",
      problemId: "2071",
      problemTitle: "평균값 구하기",
      updatedAt: "2026-08-17T01:00:00Z",
      detectedProvider: "swea",
      detectedProblemId: "10",
      detectedProblemTitle: "2071. 평균값 구하기",
    };
    const queue = [
      {
        id: "matching",
        provider: "swea",
        pageUrl: activeProblem.pageUrl,
        problemIdHint: "10",
        pageTitle: "SW Expert Academy",
        tabId: 1,
        status: "blocked",
        error: "catalog",
      },
      {
        id: "matching-alias",
        provider: "swea",
        problemContextKey: "swea:contest:AV13zo1KAAACFAYh",
        pageUrl: activeProblem.pageUrl,
        problemIdHint: "10",
        pageTitle: "SW Expert Academy",
        tabId: 2,
        status: "blocked",
        error: "catalog",
      },
      {
        id: "other-tab",
        provider: "swea",
        pageUrl: activeProblem.pageUrl,
        problemIdHint: "10",
        pageTitle: "SW Expert Academy",
        tabId: 2,
        status: "blocked",
        error: "catalog",
      },
    ] as SubmissionQueueItem[];

    expect(applyActiveProblemOverrideToQueue(queue, activeProblem, sweaCatalog, problemOverride)).toBe(true);
    expect(queue[0]).toMatchObject({
      problemContextKey: activeProblem.contextKey,
      problemId: "2071",
      problemOverride,
      status: "pending",
      error: undefined,
    });
    expect(queue[1]).toMatchObject({
      id: "matching-alias",
      problemContextKey: activeProblem.contextKey,
      problemOverride,
      status: "pending",
    });
    expect(queue[2]).toMatchObject({ id: "other-tab", status: "blocked", error: "catalog" });
    expect(queue[2]).not.toHaveProperty("problemOverride");
  });

  it("stores a validated manual override and clears the previous block", () => {
    const detected = {
      provider: "swea",
      pageUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
      problemIdHint: "10",
      status: "blocked",
      error: "catalog",
    } as SubmissionQueueItem;

    const overridden = applyProblemOverride(detected, sweaCatalog, "swea", "2071", "2026-08-17T01:00:00Z");

    expect(overridden).toMatchObject({
      provider: "swea",
      problemIdHint: "10",
      problemId: "2071",
      problemTitle: "평균값 구하기",
      problemOverride: {
        provider: "swea",
        problemId: "2071",
        problemTitle: "평균값 구하기",
        updatedAt: "2026-08-17T01:00:00Z",
      },
      status: "pending",
      error: undefined,
    });
  });

  it("repairs a duplicate blocked item with newly captured SWEA metadata", async () => {
    const blocked = {
      id: "submission",
      provider: "swea",
      pageUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
      problemIdHint: "10",
      pageTitle: "SW Expert Academy",
      tabId: 1,
      capturedAt: "2026-08-17T01:00:00Z",
      acceptedAt: "2026-08-17T01:01:00Z",
      compactDate: "260817",
      date: "2026-08-17",
      code: "class Main {}",
      codeHash: await crypto.subtle.digest("SHA-256", new TextEncoder().encode("class Main {}"))
        .then((value) => [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("")),
      language: "java",
      status: "blocked",
      error: "현재 문제를 leetdash 카탈로그에서 찾지 못했습니다.",
      attempts: 1,
    } as SubmissionQueueItem;
    await chrome.storage.local.set({ pendingQueue: [blocked], syncHistory: [], pullSnapshots: {} });
    const repairedAttempt = {
      id: "new-attempt",
      provider: "swea",
      pageUrl: blocked.pageUrl,
      problemIdHint: "2071",
      pageTitle: "2071. 평균값 구하기",
      tabId: 1,
      frameId: 0,
      capturedAt: "2026-08-17T01:02:00Z",
      code: blocked.code,
      language: "java",
    } as PendingAttempt;

    const repaired = await enqueueAccepted(repairedAttempt, "2026-08-17T01:03:00Z");

    expect(repaired).toMatchObject({
      id: "submission",
      problemIdHint: "2071",
      pageTitle: "2071. 평균값 구하기",
      status: "pending",
      error: undefined,
    });
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({ pendingQueue: [repaired] });

    const overridden = applyProblemOverride(repaired, sweaCatalog, "swea", "2071");
    await chrome.storage.local.set({ pendingQueue: [overridden] });
    const redetected = await enqueueAccepted({
      ...repairedAttempt,
      problemIdHint: "1204",
      pageTitle: "1204. 최빈수",
    });
    expect(redetected).toMatchObject({
      problemIdHint: "2071",
      pageTitle: "2071. 평균값 구하기",
      problemOverride: { provider: "swea", problemId: "2071" },
    });
  });

  it("removes synchronized work from the code-bearing queue and retains only code-free history", () => {
    const queue = [{ id: "submission", code: "secret", status: "syncing" }] as SubmissionQueueItem[];
    const history: SyncHistoryItem[] = [];
    const completed = { id: "submission", status: "synced", syncedAt: "2026-08-17T01:00:00Z" } as SyncHistoryItem;

    moveCompletedToHistory(queue, 0, history, completed);

    expect(queue).toEqual([]);
    expect(history).toEqual([completed]);
    expect(history[0]).not.toHaveProperty("code");
  });

  it("allows the same page and code to be synchronized again under a different manual problem number", async () => {
    const attempt = {
      id: "first-submission",
      provider: "swea",
      pageUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
      problemContextKey: "swea:title:2071. 평균값 구하기",
      problemIdHint: "10",
      pageTitle: "2071. 평균값 구하기",
      tabId: 1,
      frameId: 0,
      capturedAt: "2026-08-17T01:00:00Z",
      code: "class Main {}",
      language: "java",
    } as PendingAttempt;
    const first = applyProblemOverride(
      await enqueueAccepted(attempt, "2026-08-17T01:01:00Z"),
      sweaCatalog,
      "swea",
      "2071",
    );
    const firstQueue = [first];
    const history: SyncHistoryItem[] = [];

    moveCompletedToHistory(firstQueue, 0, history, {
      ...first,
      status: "synced",
      syncedAt: "2026-08-17T01:02:00Z",
      problemId: "2071",
      path: "submissions/ada/swea/2071/Solution.java",
    });
    await chrome.storage.local.set({ pendingQueue: firstQueue });

    const second = applyProblemOverride(
      await enqueueAccepted({ ...attempt, id: "second-submission" }, "2026-08-17T01:03:00Z"),
      sweaCatalog,
      "swea",
      "1204",
    );

    expect(history).toHaveLength(1);
    expect(second).toMatchObject({
      id: "second-submission",
      problemId: "1204",
      problemOverride: { provider: "swea", problemId: "1204" },
      status: "pending",
    });
  });
});
