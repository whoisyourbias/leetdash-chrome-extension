import type { AuthState, DailyPullRequest, DeviceSession, ExtensionSettings, PendingAttempt, ProblemCatalog, SubmissionQueueItem, SyncActivity } from "../shared/model.js";

export const storageKeys = {
  auth: "auth",
  branchClaims: "branchClaims",
  catalog: "catalog",
  dailyPulls: "dailyPulls",
  deviceSession: "deviceSession",
  pendingAttempts: "pendingAttempts",
  queue: "queue",
  settings: "settings",
  syncActivity: "syncActivity",
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
export const getDailyPulls = () => getStored<Record<string, DailyPullRequest>>(storageKeys.dailyPulls, {});
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
export async function getQueue(): Promise<SubmissionQueueItem[]> {
  const queue = await getStored<unknown>(storageKeys.queue, []);
  return Array.isArray(queue) ? queue as SubmissionQueueItem[] : [];
}
