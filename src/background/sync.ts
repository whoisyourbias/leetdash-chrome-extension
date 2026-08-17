import { isProblemCatalog, resolveCatalogProblem } from "../shared/catalog.js";
import { sha256 } from "../shared/crypto.js";
import { toSeoulDate } from "../shared/date.js";
import { languageExtension } from "../shared/languages.js";
import type {
  AuthState,
  DailyPullRequest,
  PendingAttempt,
  ProblemCatalog,
  SubmissionQueueItem,
  SyncProgressEvent,
  SyncStage,
} from "../shared/model.js";
import { GitHubClient, GitHubError, submissionBranch } from "./github.js";
import {
  getCatalogCache,
  getBranchClaims,
  getDailyPulls,
  getQueue,
  getSettings,
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
  const queue = await getQueue();
  const codeHash = await sha256(attempt.code);
  const date = toSeoulDate(acceptedAt);
  const duplicate = queue.find((item) => (
    item.provider === attempt.provider
    && item.pageUrl === attempt.pageUrl
    && item.codeHash === codeHash
    && item.status !== "blocked"
  ));
  if (duplicate) return duplicate;
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
  await setStored(storageKeys.queue, queue.slice(-100));
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
  dailyPulls: Record<string, DailyPullRequest>,
  report: ProgressReporter,
): Promise<SubmissionQueueItem> {
  if (!item.code) throw new GitHubError("동기화할 코드가 로컬 큐에 없습니다.", 422);
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
  const resolved = resolveCatalogProblem(catalog, item.provider, item.pageUrl, item.problemIdHint);
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
  let dailyPull: DailyPullRequest | undefined = dailyPulls[item.date];
  if (!dailyPull && !branchState.created && !branchState.atBase) {
    dailyPull = await client.findManagedDraftPull(auth.login, branch, item.date);
    if (!dailyPull && branchClaims[claimKey] !== branch) {
      throw new GitHubError(`${branch} branch가 이미 존재하며 확장 프로그램 소유로 확인되지 않았습니다.`, 422);
    }
  }
  if (dailyPull) dailyPulls[item.date] = dailyPull;
  branchClaims[claimKey] = branch;
  await setStored(storageKeys.branchClaims, branchClaims);
  const commit = await client.commitSolution({
    fork,
    branch,
    directory,
    extension,
    code: item.code,
    message: `solve: ${item.provider} ${resolved.problem.problemId}`,
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
    dailyPulls[item.date] = dailyPull;
  }
  return {
    ...item,
    code: undefined,
    status: "synced",
    problemId: resolved.problem.problemId,
    problemTitle: resolved.problem.title,
    path: `${directory}/Solution.${extension}`,
    prUrl: dailyPull?.url,
    error: undefined,
    retryAt: undefined,
  };
}

export async function closePastDrafts(
  auth: AuthState,
  client: GitHubClient,
  queue: SubmissionQueueItem[],
  dailyPulls: Record<string, DailyPullRequest>,
  now = new Date(),
  autoReadyAfterMidnight = true,
): Promise<void> {
  if (!autoReadyAfterMidnight) return;
  const today = toSeoulDate(now).date;
  for (const [date, record] of Object.entries(dailyPulls).sort(([left], [right]) => left.localeCompare(right))) {
    if (date >= today || !record.draft) continue;
    const unfinished = queue.some((item) => item.date === date && item.status !== "synced");
    if (unfinished) continue;
    const live = await client.getPull(record.number);
    if (live.state !== "open") {
      dailyPulls[date] = { ...record, draft: false };
      continue;
    }
    if (live.draft) await client.markReady(live.node_id ?? record.nodeId);
    dailyPulls[date] = { ...record, nodeId: live.node_id ?? record.nodeId, draft: false };
  }
  await setStored(storageKeys.dailyPulls, dailyPulls);
}

export async function refreshTodayPull(
  auth: AuthState,
  client: GitHubClient,
  dailyPulls: Record<string, DailyPullRequest>,
  now = new Date(),
): Promise<{ date: string; pull?: DailyPullRequest }> {
  const today = toSeoulDate(now);
  const branch = submissionBranch(auth.login, today.compact);
  const pull = await client.findManagedOpenPull(auth.login, branch, today.date);
  const cached = dailyPulls[today.date];
  const changed = pull
    ? !cached
      || cached.compactDate !== pull.compactDate
      || cached.branch !== pull.branch
      || cached.number !== pull.number
      || cached.nodeId !== pull.nodeId
      || cached.url !== pull.url
      || cached.draft !== pull.draft
    : cached !== undefined;

  if (pull) dailyPulls[today.date] = pull;
  else delete dailyPulls[today.date];
  if (changed) await setStored(storageKeys.dailyPulls, dailyPulls);
  return { date: today.date, pull };
}

export async function synchronize(
  auth: AuthState,
  fetchImpl: typeof fetch = fetch,
  onProgress?: (event: SyncProgressEvent) => void | Promise<void>,
): Promise<void> {
  const client = new GitHubClient(auth.token, fetchImpl);
  const queue = await getQueue();
  const dailyPulls = await getDailyPulls();

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.status === "synced" || current.status === "blocked") continue;
    if (current.retryAt && Date.parse(current.retryAt) > Date.now()) continue;
    queue[index] = { ...current, status: "syncing", attempts: current.attempts + 1 };
    await setStored(storageKeys.queue, queue);
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
      queue[index] = await syncItem(queue[index], auth, client, dailyPulls, report);
      await Promise.all([
        setStored(storageKeys.queue, queue),
        setStored(storageKeys.dailyPulls, dailyPulls),
      ]);
      await onProgress?.({
        itemId: current.id,
        title: queue[index].problemTitle ?? title,
        stage: "complete",
        status: "completed",
        message: queue[index].prUrl ? "Draft PR 업로드를 완료했습니다." : "GitHub 동기화를 완료했습니다.",
      });
    } catch (error) {
      const attempts = queue[index].attempts;
      queue[index] = {
        ...queue[index],
        status: isBlocked(error) ? "blocked" : "pending",
        error: error instanceof Error ? error.message : "알 수 없는 동기화 오류입니다.",
        retryAt: isBlocked(error) ? undefined : new Date(Date.now() + retryDelay(attempts, error)).toISOString(),
      };
      await setStored(storageKeys.queue, queue);
      await onProgress?.({
        itemId: current.id,
        title,
        stage: activeStage,
        status: "failed",
        message: queue[index].error ?? "알 수 없는 동기화 오류입니다.",
      });
    }
  }
  const settings = await getSettings();
  await closePastDrafts(auth, client, queue, dailyPulls, new Date(), settings.autoReadyAfterMidnight);
}
