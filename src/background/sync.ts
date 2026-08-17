import { isProblemCatalog, resolveCatalogProblem } from "../shared/catalog.js";
import { sha256 } from "../shared/crypto.js";
import { toSeoulDate } from "../shared/date.js";
import { languageExtension } from "../shared/languages.js";
import type {
  AuthState,
  DailyPullRequest,
  PendingAttempt,
  ProblemCatalog,
  Provider,
  SubmissionQueueItem,
  SyncProgressEvent,
  SyncHistoryItem,
  SyncStage,
} from "../shared/model.js";
import { GitHubClient, GitHubError, submissionBranch } from "./github.js";
import {
  getCatalogCache,
  getBranchClaims,
  getPendingQueue,
  getPullSnapshots,
  getSettings,
  getSyncHistory,
  removeStored,
  setStored,
  storageKeys,
  type CatalogCache,
} from "./storage.js";

const catalogTtlMs = 60 * 60 * 1000;
type ProgressReporter = (stage: SyncStage, message: string) => void | Promise<void>;

export async function enqueueAccepted(
  attempt: PendingAttempt,
  acceptedAt = new Date().toISOString(),
): Promise<SubmissionQueueItem> {
  const queue = await getPendingQueue();
  const codeHash = await sha256(attempt.code);
  const date = toSeoulDate(acceptedAt);
  const duplicate = queue.find((item) => (
    item.provider === attempt.provider
    && item.pageUrl === attempt.pageUrl
    && item.codeHash === codeHash
  ));
  if (duplicate) {
    Object.assign(duplicate, attempt, {
      id: duplicate.id,
      status: "pending",
      error: undefined,
      blockReason: undefined,
      retryAt: undefined,
    });
    await setStored(storageKeys.pendingQueue, queue);
    return duplicate;
  }
  const item: SubmissionQueueItem = {
    ...attempt,
    acceptedAt,
    codeHash,
    compactDate: date.compact,
    date: date.date,
    status: "pending",
    attempts: 0,
  };
  queue.push(item);
  await setStored(storageKeys.pendingQueue, queue);
  return item;
}

async function loadCatalog(client: GitHubClient): Promise<ProblemCatalog> {
  const cached = await getCatalogCache();
  if (
    cached?.schemaVersion === 1
    && isProblemCatalog(cached.catalog)
    && Date.now() - Date.parse(cached.fetchedAt) < catalogTtlMs
  ) return cached.catalog;
  if (cached) await removeStored(storageKeys.catalog);
  const catalog = await client.readCatalog();
  if (!isProblemCatalog(catalog)) throw new GitHubError("GitHub 문제 카탈로그 구조가 올바르지 않습니다.", 502);
  const next: CatalogCache = { schemaVersion: 1, fetchedAt: new Date().toISOString(), catalog };
  await setStored(storageKeys.catalog, next);
  return catalog;
}

export function applyProblemOverride(
  item: SubmissionQueueItem,
  catalog: ProblemCatalog,
  provider: Provider,
  problemId: string,
  updatedAt = new Date().toISOString(),
): SubmissionQueueItem {
  if (item.status === "syncing") throw new Error("업로드 중인 제출은 문제 정보를 수정할 수 없습니다.");
  const normalizedProblemId = problemId.trim();
  if (!/^\d{1,8}$/.test(normalizedProblemId)) throw new Error("문제 번호는 1~8자리 숫자로 입력하세요.");
  const resolved = resolveCatalogProblem(
    catalog,
    item.provider,
    item.pageUrl,
    item.problemIdHint,
    { provider, problemId: normalizedProblemId },
  );
  if (!resolved) throw new Error(`${provider} ${normalizedProblemId} 문제를 leetdash 카탈로그에서 찾지 못했습니다.`);
  return {
    ...item,
    status: "pending",
    problemId: resolved.problem.problemId,
    problemTitle: resolved.problem.title,
    problemOverride: {
      provider,
      problemId: resolved.problem.problemId,
      problemTitle: resolved.problem.title,
      updatedAt,
    },
    error: undefined,
    blockReason: undefined,
    retryAt: undefined,
  };
}

export async function saveProblemOverride(
  auth: AuthState,
  itemId: string,
  provider: Provider,
  problemId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmissionQueueItem> {
  let queue = await getPendingQueue();
  let index = queue.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("수정할 미동기화 제출을 찾지 못했습니다.");
  if (queue[index].status === "syncing") throw new Error("업로드 중인 제출은 문제 정보를 수정할 수 없습니다.");
  const catalog = await loadCatalog(new GitHubClient(auth.token, fetchImpl));
  queue = await getPendingQueue();
  index = queue.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("문제 정보를 확인하는 동안 제출 동기화가 완료되었습니다.");
  const updated = applyProblemOverride(queue[index], catalog, provider, problemId);
  queue[index] = updated;
  await setStored(storageKeys.pendingQueue, queue);
  return updated;
}

export async function clearProblemOverride(itemId: string): Promise<SubmissionQueueItem> {
  const queue = await getPendingQueue();
  const index = queue.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("수정할 미동기화 제출을 찾지 못했습니다.");
  if (queue[index].status === "syncing") throw new Error("업로드 중인 제출은 문제 정보를 수정할 수 없습니다.");
  const {
    problemOverride: _problemOverride,
    problemId: _problemId,
    problemTitle: _problemTitle,
    error: _error,
    blockReason: _blockReason,
    retryAt: _retryAt,
    ...detected
  } = queue[index];
  const updated: SubmissionQueueItem = { ...detected, status: "pending" };
  queue[index] = updated;
  await setStored(storageKeys.pendingQueue, queue);
  return updated;
}

function retryDelay(attempts: number, error: unknown): number {
  if (error instanceof GitHubError && error.retryAfter) return error.retryAfter * 1000;
  return Math.min(15 * 60 * 1000, 15_000 * 2 ** Math.min(attempts, 6));
}

function isBlocked(error: unknown): boolean {
  return error instanceof GitHubError && [401, 403, 404, 422].includes(error.status);
}

function safeSubmissionsPath(value: string): string | undefined {
  const normalized = value.replace(/^\/+|\/+$/g, "");
  if (!normalized.startsWith("submissions/") || normalized.includes("..") || normalized.includes("\\")) return undefined;
  return normalized;
}

async function syncItem(
  item: SubmissionQueueItem,
  auth: AuthState,
  client: GitHubClient,
  report: ProgressReporter,
): Promise<{ history: SyncHistoryItem; pull?: DailyPullRequest }> {
  await report("catalog", "문제 카탈로그를 확인하는 중입니다.");
  const catalog = await loadCatalog(client);
  await report("user", "GitHub 사용자 등록 정보를 확인하는 중입니다.");
  const users = await client.readUsers();
  if (!Array.isArray(users?.users)) throw new GitHubError("GitHub 사용자 등록 파일 구조가 올바르지 않습니다.", 502);
  const user = users.users.find((candidate) => candidate.githubUsername.toLowerCase() === auth.login.toLowerCase());
  if (!user) {
    throw new GitHubError(
      `${auth.login} 계정이 중앙 whoisyourbias/leetdash 저장소의 data/users.json에 등록되지 않았습니다.`,
      422,
    );
  }
  const resolved = resolveCatalogProblem(
    catalog,
    item.provider,
    item.pageUrl,
    item.problemIdHint,
    item.problemOverride,
  );
  if (!resolved) throw new GitHubError("현재 문제를 leetdash 카탈로그에서 찾지 못했습니다.", 422);
  const extension = languageExtension(item.language);
  if (!extension) throw new GitHubError(`${item.language || "알 수 없는 언어"}는 지원하지 않는 언어입니다.`, 422);
  const submissionsPath = safeSubmissionsPath(user.submissionsPath ?? `submissions/${user.githubUsername}`);
  if (!submissionsPath) throw new GitHubError("등록된 submissionsPath가 안전하지 않습니다.", 422);

  const directory = `${submissionsPath}/${resolved.sourceKey}/${resolved.submissionKey}`;
  await report("fork", "GitHub fork 준비를 시작합니다.");
  const fork = await client.ensureFork(auth.login, (message) => report("fork", message));
  const branch = submissionBranch(auth.login, item.compactDate);
  await report("branch", "날짜별 제출 브랜치를 준비하는 중입니다.");
  const branchState = await client.ensureBranch(fork, branch, (message) => report("branch", message));
  const branchClaims = await getBranchClaims();
  const claimKey = `${auth.login.toLowerCase()}:${item.date}`;
  let dailyPull = await client.findManagedDraftPull(auth.login, branch, item.date);
  if (!dailyPull && !branchState.created && !branchState.atBase) {
    if (branchClaims[claimKey] !== branch) {
      throw new GitHubError(`${branch} branch가 이미 존재하며 확장 프로그램 소유로 확인되지 않았습니다.`, 422);
    }
  }
  branchClaims[claimKey] = branch;
  await setStored(storageKeys.branchClaims, branchClaims);
  const commit = await client.commitSolution({
    fork,
    branch,
    directory,
    extension,
    code: item.code,
    message: `solve: ${resolved.problem.provider} ${resolved.problem.problemId}`,
    onProgress: (message) => report("commit", message),
  });

  if (commit.changed || dailyPull) {
    await report("pull-request", "날짜별 Draft PR을 준비하는 중입니다.");
    dailyPull = await client.ensureDraftPull(
      auth.login,
      branch,
      item.date,
      (message) => report("pull-request", message),
    );
  }
  const { code: _code, error: _error, blockReason: _blockReason, retryAt: _retryAt, ...completed } = item;
  return { history: {
    ...completed,
    status: "synced",
    syncedAt: new Date().toISOString(),
    problemId: resolved.problem.problemId,
    problemTitle: resolved.problem.title,
    path: `${directory}/Solution.${extension}`,
    prUrl: dailyPull?.url,
  }, pull: dailyPull };
}

function samePullState(left: DailyPullRequest | undefined, right: DailyPullRequest | undefined): boolean {
  return left?.date === right?.date
    && left?.compactDate === right?.compactDate
    && left?.branch === right?.branch
    && left?.number === right?.number
    && left?.nodeId === right?.nodeId
    && left?.url === right?.url
    && left?.state === right?.state;
}

export async function pollPullRequests(
  auth: AuthState,
  client: GitHubClient,
  queue: SubmissionQueueItem[],
  pullSnapshots: Record<string, DailyPullRequest>,
  now = new Date(),
  autoReadyAfterMidnight = true,
): Promise<void> {
  const today = toSeoulDate(now).date;
  const previousDay = toSeoulDate(new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000)).date;
  const dates = new Set([today, previousDay, ...Object.keys(pullSnapshots), ...queue.map((item) => item.date)]);
  let snapshotsChanged = false;
  let queueChanged = false;

  for (const date of [...dates].sort()) {
    const compactDate = date.replaceAll("-", "").slice(2);
    let pull: DailyPullRequest | undefined;
    try {
      pull = await client.findManagedPull(auth.login, submissionBranch(auth.login, compactDate), date);
    } catch {
      continue;
    }
    if (!pull) {
      if (pullSnapshots[date]) {
        delete pullSnapshots[date];
        snapshotsChanged = true;
      }
      continue;
    }
    const unfinished = queue.some((item) => item.date === date);
    if (autoReadyAfterMidnight && date < today && pull.state === "draft" && !unfinished) {
      try {
        await client.markReady(pull.nodeId);
        pull = { ...pull, state: "ready" };
      } catch {
        // Keep the live Draft snapshot and retry the Ready transition on the next poll.
      }
    }
    if (date < today && (pull.state === "ready" || pull.state === "merged")) {
      if (pullSnapshots[date]) {
        delete pullSnapshots[date];
        snapshotsChanged = true;
      }
      continue;
    }
    if (pull.state === "draft") {
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (item.date === date && (item.blockReason === "pull_closed" || item.blockReason === "pull_ready")) {
          queue[index] = { ...item, status: "pending", error: undefined, blockReason: undefined, retryAt: undefined };
          queueChanged = true;
        }
      }
    }
    if (!samePullState(pullSnapshots[date], pull)) {
      pullSnapshots[date] = pull;
      snapshotsChanged = true;
    }
  }
  await Promise.all([
    snapshotsChanged ? setStored(storageKeys.pullSnapshots, pullSnapshots) : Promise.resolve(),
    queueChanged ? setStored(storageKeys.pendingQueue, queue) : Promise.resolve(),
  ]);
}

export async function refreshTodayPull(
  auth: AuthState,
  client: GitHubClient,
  pullSnapshots: Record<string, DailyPullRequest>,
  now = new Date(),
): Promise<{ date: string; pull?: DailyPullRequest }> {
  const today = toSeoulDate(now);
  const branch = submissionBranch(auth.login, today.compact);
  const pull = await client.findManagedPull(auth.login, branch, today.date);
  const changed = !samePullState(pullSnapshots[today.date], pull);

  if (pull) pullSnapshots[today.date] = pull;
  else delete pullSnapshots[today.date];
  if (changed) await setStored(storageKeys.pullSnapshots, pullSnapshots);
  return { date: today.date, pull };
}

export function moveCompletedToHistory(
  queue: SubmissionQueueItem[],
  index: number,
  history: SyncHistoryItem[],
  completed: SyncHistoryItem,
): void {
  queue.splice(index, 1);
  history.push(completed);
  if (history.length > 100) history.splice(0, history.length - 100);
}

export async function synchronize(
  auth: AuthState,
  fetchImpl: typeof fetch = fetch,
  onProgress?: (event: SyncProgressEvent) => void | Promise<void>,
): Promise<void> {
  const client = new GitHubClient(auth.token, fetchImpl);
  const [queue, history, pullSnapshots, settings] = await Promise.all([
    getPendingQueue(), getSyncHistory(), getPullSnapshots(), getSettings(),
  ]);
  await pollPullRequests(auth, client, queue, pullSnapshots, new Date(), settings.autoReadyAfterMidnight);

  for (let index = 0; index < queue.length;) {
    const current = queue[index];
    if (current.status === "blocked") {
      index += 1;
      continue;
    }
    if (current.retryAt && Date.parse(current.retryAt) > Date.now()) {
      index += 1;
      continue;
    }
    queue[index] = { ...current, status: "syncing", attempts: current.attempts + 1 };
    await setStored(storageKeys.pendingQueue, queue);
    let activeStage: SyncStage = "catalog";
    const title = current.problemTitle ?? current.pageTitle ?? `${current.provider} 제출`;
    const report: ProgressReporter = async (stage, message) => {
      activeStage = stage;
      await onProgress?.({
        itemId: current.id,
        title,
        stage,
        status: "running",
        message,
      });
    };
    try {
      await report("catalog", "동기화를 시작합니다.");
      const completed = await syncItem(queue[index], auth, client, report);
      moveCompletedToHistory(queue, index, history, completed.history);
      if (completed.pull) pullSnapshots[completed.pull.date] = completed.pull;
      await Promise.all([
        setStored(storageKeys.pendingQueue, queue),
        setStored(storageKeys.syncHistory, history),
        setStored(storageKeys.pullSnapshots, pullSnapshots),
      ]);
      await onProgress?.({
        itemId: current.id,
        title: completed.history.problemTitle ?? title,
        stage: "complete",
        status: "completed",
        message: completed.history.prUrl ? "Draft PR 업로드를 완료했습니다." : "GitHub 동기화를 완료했습니다.",
      });
    } catch (error) {
      const attempts = queue[index].attempts;
      queue[index] = {
        ...queue[index],
        status: isBlocked(error) ? "blocked" : "pending",
        error: error instanceof Error ? error.message : "알 수 없는 동기화 오류입니다.",
        blockReason: error instanceof GitHubError ? error.blockReason : undefined,
        retryAt: isBlocked(error) ? undefined : new Date(Date.now() + retryDelay(attempts, error)).toISOString(),
      };
      await setStored(storageKeys.pendingQueue, queue);
      await onProgress?.({
        itemId: current.id,
        title,
        stage: activeStage,
        status: "failed",
        message: queue[index].error ?? "알 수 없는 동기화 오류입니다.",
      });
      index += 1;
    }
  }
}
