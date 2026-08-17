import type { AuthState, DailyPullRequest, DeviceSession, ExtensionSettings, PendingAttempt, ProblemCatalog, SubmissionQueueItem, SyncActivity, SyncHistoryItem } from "../shared/model.js";

export const storageKeys = {
  auth: "auth",
  branchClaims: "branchClaims",
  catalog: "catalog",
  deviceSession: "deviceSession",
  pendingAttempts: "pendingAttempts",
  pendingQueue: "pendingQueue",
  pullSnapshots: "pullSnapshots",
  settings: "settings",
  syncHistory: "syncHistory",
  syncActivity: "syncActivity",
} as const;

const legacyStorageKeys = {
  dailyPulls: "dailyPulls",
  queue: "queue",
} as const;

export const defaultSettings: ExtensionSettings = {
  autoReadyAfterMidnight: true,
};

export interface CatalogCache {
  schemaVersion: 1;
  fetchedAt: string;
  catalog: ProblemCatalog;
}

export async function getStored<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

export async function setStored(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeStored(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

export const getAuth = () => getStored<AuthState | undefined>(storageKeys.auth, undefined);
export const getBranchClaims = () => getStored<Record<string, string>>(storageKeys.branchClaims, {});
export const getCatalogCache = () => getStored<CatalogCache | undefined>(storageKeys.catalog, undefined);
export const getDeviceSession = () => getStored<DeviceSession | undefined>(storageKeys.deviceSession, undefined);
export const getPendingAttempts = () => getStored<Record<string, PendingAttempt>>(storageKeys.pendingAttempts, {});
export async function getSettings(): Promise<ExtensionSettings> {
  const settings = await getStored<Partial<ExtensionSettings> | undefined>(storageKeys.settings, undefined);
  return {
    autoReadyAfterMidnight: typeof settings?.autoReadyAfterMidnight === "boolean"
      ? settings.autoReadyAfterMidnight
      : defaultSettings.autoReadyAfterMidnight,
  };
}
export async function getSyncActivity(): Promise<SyncActivity | undefined> {
  const activity = await getStored<unknown>(storageKeys.syncActivity, undefined);
  if (!activity || typeof activity !== "object") return undefined;
  const candidate = activity as SyncActivity;
  if (
    typeof candidate.itemId !== "string"
    || typeof candidate.title !== "string"
    || typeof candidate.stage !== "string"
    || !["running", "completed", "failed"].includes(candidate.status)
    || typeof candidate.message !== "string"
  ) return undefined;
  return candidate;
}
let storageMigration: Promise<void> | undefined;

async function ensureStorageMigration(): Promise<void> {
  if (storageMigration) return storageMigration;
  storageMigration = (async () => {
    const stored = await chrome.storage.local.get([
      storageKeys.pendingQueue,
      storageKeys.pullSnapshots,
      storageKeys.syncHistory,
      legacyStorageKeys.dailyPulls,
      legacyStorageKeys.queue,
    ]);
    const updates: Record<string, unknown> = {};
    const legacyQueue = Array.isArray(stored[legacyStorageKeys.queue])
      ? stored[legacyStorageKeys.queue] as Array<Record<string, any>>
      : [];

    if (!Array.isArray(stored[storageKeys.pendingQueue])) {
      updates[storageKeys.pendingQueue] = legacyQueue.filter((item) => (
        item.status !== "synced" && typeof item.code === "string" && item.code.length > 0
      ));
    }
    if (!Array.isArray(stored[storageKeys.syncHistory])) {
      updates[storageKeys.syncHistory] = legacyQueue
        .filter((item) => item.status === "synced")
        .map(({ code: _code, error: _error, retryAt: _retryAt, blockReason: _blockReason, ...item }) => ({
          ...item,
          status: "synced",
          syncedAt: typeof item.syncedAt === "string" ? item.syncedAt : item.acceptedAt,
        }));
    }
    if (!stored[storageKeys.pullSnapshots] || typeof stored[storageKeys.pullSnapshots] !== "object") {
      const legacyPulls = stored[legacyStorageKeys.dailyPulls];
      updates[storageKeys.pullSnapshots] = legacyPulls && typeof legacyPulls === "object"
        ? Object.fromEntries(Object.entries(legacyPulls as Record<string, any>).map(([date, pull]) => [date, {
          ...pull,
          state: pull?.draft ? "draft" : "ready",
        }]))
        : {};
    }
    if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
    await chrome.storage.local.remove([legacyStorageKeys.dailyPulls, legacyStorageKeys.queue]);
  })().catch((error) => {
    storageMigration = undefined;
    throw error;
  });
  return storageMigration;
}

export async function getPendingQueue(): Promise<SubmissionQueueItem[]> {
  await ensureStorageMigration();
  const queue = await getStored<unknown>(storageKeys.pendingQueue, []);
  return Array.isArray(queue) ? queue as SubmissionQueueItem[] : [];
}

export async function getSyncHistory(): Promise<SyncHistoryItem[]> {
  await ensureStorageMigration();
  const history = await getStored<unknown>(storageKeys.syncHistory, []);
  return Array.isArray(history) ? history as SyncHistoryItem[] : [];
}

export async function getPullSnapshots(): Promise<Record<string, DailyPullRequest>> {
  await ensureStorageMigration();
  return getStored<Record<string, DailyPullRequest>>(storageKeys.pullSnapshots, {});
}
