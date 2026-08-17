export type Provider = "leetcode" | "programmers" | "swea";

export interface EditorSnapshot {
  code: string;
  language: string;
}

export interface PendingAttempt extends EditorSnapshot {
  id: string;
  provider: Provider;
  problemIdHint?: string;
  pageTitle: string;
  pageUrl: string;
  tabId: number;
  capturedAt: string;
}

export type QueueStatus = "pending" | "syncing" | "synced" | "blocked";

export type SyncStage = "catalog" | "user" | "fork" | "branch" | "commit" | "pull-request" | "complete";

export interface SyncActivity {
  itemId: string;
  title: string;
  stage: SyncStage;
  status: "running" | "completed" | "failed";
  message: string;
  startedAt: string;
  updatedAt: string;
}

export interface SyncProgressEvent {
  itemId: string;
  title: string;
  stage: SyncStage;
  status: SyncActivity["status"];
  message: string;
}

export interface ExtensionSettings {
  autoReadyAfterMidnight: boolean;
}

export interface SubmissionQueueItem extends Omit<PendingAttempt, "code"> {
  code?: string;
  acceptedAt: string;
  codeHash: string;
  compactDate: string;
  date: string;
  status: QueueStatus;
  problemId?: string;
  problemTitle?: string;
  path?: string;
  prUrl?: string;
  error?: string;
  retryAt?: string;
  attempts: number;
}

export interface AuthState {
  token: string;
  login: string;
  avatarUrl?: string;
}

export interface DeviceSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
  nextPollAt: string;
  error?: string;
}

export interface DailyPullRequest {
  date: string;
  compactDate: string;
  branch: string;
  number: number;
  nodeId: string;
  url: string;
  draft: boolean;
}

export interface CatalogProblem {
  provider: Provider;
  problemId: string;
  problemKey: string;
  slug?: string;
  title: string;
  sourceUrl: string;
}

export interface CatalogList {
  key: string;
  problems: CatalogProblem[];
  items: Array<{ problemKey: string; submissionKey: string }>;
}

export interface ProblemCatalog {
  lists: CatalogList[];
}

export interface RegisteredUser {
  githubUsername: string;
  submissionsPath?: string;
}

export interface UsersFile {
  users: RegisteredUser[];
}
