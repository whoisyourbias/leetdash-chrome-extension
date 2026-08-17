import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSettings, getSyncActivity } from "../src/background/storage";

describe("sync activity storage", () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(),
        },
      },
    };
  });

  it("restores a valid progress activity for popup rendering", async () => {
    chrome.storage.local.get = vi.fn(async () => ({
      syncActivity: {
        itemId: "submission-1",
        title: "하노이의 탑",
        stage: "fork",
        status: "running",
        message: "GitHub fork를 생성하는 중입니다.",
        startedAt: "2026-08-17T08:00:00.000Z",
        updatedAt: "2026-08-17T08:00:01.000Z",
      },
    }));

    await expect(getSyncActivity()).resolves.toMatchObject({
      itemId: "submission-1",
      stage: "fork",
      status: "running",
    });
  });

  it("ignores malformed activity state", async () => {
    chrome.storage.local.get = vi.fn(async () => ({
      syncActivity: { itemId: "submission-1", status: "working" },
    }));

    await expect(getSyncActivity()).resolves.toBeUndefined();
  });

  it("enables automatic Ready transition by default", async () => {
    chrome.storage.local.get = vi.fn(async () => ({}));

    await expect(getSettings()).resolves.toEqual({ autoReadyAfterMidnight: true });
  });

  it("restores a user's disabled automatic Ready setting", async () => {
    chrome.storage.local.get = vi.fn(async () => ({
      settings: { autoReadyAfterMidnight: false },
    }));

    await expect(getSettings()).resolves.toEqual({ autoReadyAfterMidnight: false });
  });
});
