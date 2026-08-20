import { pollDeviceFlow, startDeviceFlow, withUnauthorizedHandler } from "./auth.js";
import {
  getAuth,
  getDeviceSession,
  getPendingAttempts,
  getPendingQueue,
  getProblemOverrides,
  getPullSnapshots,
  getSettings,
  getSyncActivity,
  getSyncHistory,
  removeStored,
  setStored,
  storageKeys,
} from "./storage.js";
import {
  clearActiveProblemOverride,
  clearProblemOverride,
  enqueueAccepted,
  loadCatalog,
  refreshTodayPull,
  releaseUnauthorizedQueueItems,
  saveActiveProblemOverride,
  saveProblemOverride,
  synchronize,
} from "./sync.js";
import { GitHubClient, isGitHubUnauthorized } from "./github.js";
import { nextSeoulMidnight, toSeoulDate } from "../shared/date.js";
import { providerForUrl, resolveCatalogProblem } from "../shared/catalog.js";
import { problemContextKey } from "../shared/problem-context.js";
import type { ActiveProblem, AuthState, DailyPullRequest, EditorSnapshot, PendingAttempt, Provider, SubmissionQueueItem, SyncProgressEvent } from "../shared/model.js";

const SYNC_ALARM = "submission-sync";
const CLOSE_ALARM = "day-close";
const AUTH_ALARM = "auth-poll";
let synchronization: Promise<void> | undefined;

async function publishSyncProgress(event: SyncProgressEvent): Promise<void> {
  const previous = await getSyncActivity();
  const now = new Date().toISOString();
  await setStored(storageKeys.syncActivity, {
    ...event,
    startedAt: previous?.itemId === event.itemId ? previous.startedAt : now,
    updatedAt: now,
  });
}

function scheduleAlarms(): void {
  chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  chrome.alarms.create(CLOSE_ALARM, { when: nextSeoulMidnight() });
}

async function invalidateAuth(auth: AuthState): Promise<void> {
  const storedAuth = await getAuth();
  if (storedAuth?.token === auth.token) await removeStored(storageKeys.auth);
}

function fetchForAuth(auth: AuthState): typeof fetch {
  return withUnauthorizedHandler(fetch, () => invalidateAuth(auth));
}

async function runSynchronization(): Promise<void> {
  if (synchronization) return synchronization;
  const auth = await getAuth();
  if (!auth) return;
  synchronization = synchronize(auth, fetchForAuth(auth), publishSyncProgress)
    .catch(() => undefined)
    .finally(() => { synchronization = undefined; });
  return synchronization;
}

async function pollAuthentication(): Promise<void> {
  const session = await getDeviceSession();
  if (!session) return;
  try {
    const result = await pollDeviceFlow(session);
    if (result.auth) {
      const users = await new GitHubClient(result.auth.token).readUsers();
      const registered = users.users.some(
        (user) => user.githubUsername.toLowerCase() === result.auth!.login.toLowerCase(),
      );
      if (!registered) {
        throw new Error(`${result.auth.login} 계정이 중앙 whoisyourbias/leetdash 저장소의 data/users.json에 등록되지 않았습니다.`);
      }
      const queue = await getPendingQueue();
      const queueChanged = releaseUnauthorizedQueueItems(queue);
      await Promise.all([
        setStored(storageKeys.auth, result.auth),
        queueChanged ? setStored(storageKeys.pendingQueue, queue) : Promise.resolve(),
        removeStored(storageKeys.deviceSession),
        chrome.alarms.clear(AUTH_ALARM),
      ]);
      void runSynchronization();
    } else if (result.session) {
      await setStored(storageKeys.deviceSession, result.session);
    }
  } catch (error) {
    await setStored(storageKeys.deviceSession, {
      ...session,
      error: error instanceof Error ? error.message : "GitHub 로그인 오류입니다.",
    });
    await chrome.alarms.clear(AUTH_ALARM);
  }
}

function readEditorSnapshot(provider: Provider): EditorSnapshot {
  const pageWindow = window as any;
  let code = "";
  let language = "";

  const models = pageWindow.monaco?.editor?.getModels?.() ?? [];
  const modelValues = models
    .map((model: any) => ({ code: String(model.getValue?.() ?? ""), language: String(model.getLanguageId?.() ?? "") }))
    .filter((entry: EditorSnapshot) => entry.code.trim());
  if (modelValues.length > 0) {
    const selected = modelValues.sort((left: EditorSnapshot, right: EditorSnapshot) => right.code.length - left.code.length)[0];
    code = selected.code;
    language = selected.language;
  }

  if (!code && pageWindow.ace) {
    const element = document.querySelector(".ace_editor");
    if (element) {
      const editor = pageWindow.ace.edit(element);
      code = String(editor?.getValue?.() ?? "");
      language = String(editor?.session?.getMode?.()?.$id ?? "").split("/").pop() ?? "";
    }
  }

  if (!code) {
    for (const element of [...document.querySelectorAll(".CodeMirror")] as any[]) {
      const value = String(element.CodeMirror?.getValue?.() ?? "");
      if (value.length > code.length) code = value;
      const mode = element.CodeMirror?.getOption?.("mode");
      if (!language && typeof mode === "string") language = mode;
      if (!language && typeof mode?.name === "string") language = mode.name;
    }
  }

  if (!code) {
    const textareas = [...document.querySelectorAll("textarea")]
      .filter((element) => (element as HTMLTextAreaElement).value.trim())
      .sort((left, right) => (right as HTMLTextAreaElement).value.length - (left as HTMLTextAreaElement).value.length);
    code = (textareas[0] as HTMLTextAreaElement | undefined)?.value ?? "";
  }

  const languageSelectors = [
    "select option:checked",
    "[data-cy='lang-select']",
    "[data-e2e-locator*='lang']",
    "button[id*='lang']",
    "[class*='language'] [aria-selected='true']",
  ];
  for (const selector of languageSelectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (!language && text && text.length < 40) {
      language = text;
      break;
    }
  }
  if (provider === "programmers" && !language) {
    language = document.querySelector("select[name*='language'] option:checked")?.textContent?.trim() ?? "";
  }
  return { code, language };
}

function readSweaProblemMetadata(): { problemIdHint?: string; pageTitle?: string; pageUrl?: string } {
  const documents: Document[] = [document];
  try {
    if (window.top?.document && window.top.document !== document) documents.unshift(window.top.document);
  } catch {
    // Cross-origin frames can only inspect their own document.
  }
  const urls: URL[] = [new URL(location.href)];
  try {
    if (window.top?.location.href && window.top.location.href !== location.href) urls.unshift(new URL(window.top.location.href));
  } catch {
    // Cross-origin frames can only inspect their own URL.
  }
  for (const pageUrl of urls) {
    const value = pageUrl.searchParams.get("problemId") ?? pageUrl.searchParams.get("problemTitle");
    const match = /^\s*(\d{1,8})(?:\s*\.|\s|$)/.exec(value ?? "");
    if (match) return { problemIdHint: match[1], pageUrl: pageUrl.href };
  }
  const contextUrl = urls.find((pageUrl) => pageUrl.searchParams.has("contestProbId") || pageUrl.searchParams.has("problemId")) ?? urls[0];
  const selectors = [
    "h1, h2, h3, h4",
    "[class*='problem'] [class*='title']",
    "[class*='problem'][class*='title']",
    "[id*='problem'][id*='title']",
    "[class*='problem'] [class*='num']",
    ".week_num",
  ];
  for (const pageDocument of documents) {
    for (const selector of selectors) {
      for (const element of pageDocument.querySelectorAll(selector)) {
        for (const line of (element.textContent ?? "").split(/\r?\n/)) {
          const match = /^\s*(\d{3,8})\s*\.\s*\S/.exec(line);
          if (match) return { problemIdHint: match[1], pageTitle: line.trim(), pageUrl: contextUrl.href };
        }
      }
    }
    const bodyMatch = /(?:^|\n)\s*(\d{3,8})\s*\.\s*([^\n]+)/m.exec(pageDocument.body?.innerText ?? "");
    if (bodyMatch) return { problemIdHint: bodyMatch[1], pageTitle: `${bodyMatch[1]}. ${bodyMatch[2].trim()}`, pageUrl: contextUrl.href };
  }
  return { pageUrl: contextUrl.href };
}

async function getActiveProblem(auth: AuthState | undefined): Promise<ActiveProblem | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!Number.isInteger(tab?.id) || typeof tab.url !== "string") return undefined;
  const provider = providerForUrl(tab.url);
  if (!provider) return undefined;

  let detectedProblemId: string | undefined;
  let detectedProblemTitle: string | undefined;
  let contextKey = problemContextKey(provider, tab.url);
  const contextKeys = new Set<string>();
  if (contextKey) contextKeys.add(contextKey);
  if (provider === "swea") {
    try {
      const execution = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: readSweaProblemMetadata,
      });
      const candidates = execution.map((entry: any) => entry.result)
        .filter((result: any) => result && typeof result === "object") as Array<{
          problemIdHint?: string;
          pageTitle?: string;
          pageUrl?: string;
        }>;
      for (const candidate of candidates) {
        if (typeof candidate.pageUrl !== "string") continue;
        const titleKey = problemContextKey(provider, candidate.pageUrl, candidate.pageTitle);
        const urlKey = problemContextKey(provider, candidate.pageUrl);
        if (titleKey) contextKeys.add(titleKey);
        if (urlKey) contextKeys.add(urlKey);
      }
      const metadata = candidates.find((candidate) => (
        typeof candidate.pageUrl === "string"
        && Boolean(problemContextKey(provider, candidate.pageUrl, candidate.pageTitle))
        && typeof candidate.problemIdHint === "string"
      )) ?? candidates.find((candidate) => typeof candidate.problemIdHint === "string");
      detectedProblemId = metadata?.problemIdHint;
      detectedProblemTitle = metadata?.pageTitle;
      if (metadata?.pageUrl) {
        contextKey = problemContextKey(provider, metadata.pageUrl, metadata.pageTitle) ?? contextKey;
        if (contextKey) contextKeys.add(contextKey);
      }
    } catch {
      // The popup can still show URL-derived metadata when the page cannot be inspected.
    }
  }
  if (!contextKey) return undefined;

  const overrides = await getProblemOverrides();
  const problemOverride = [...contextKeys].map((key) => overrides[key]).find(Boolean);
  if (problemOverride) {
    detectedProblemId ??= problemOverride.detectedProblemId;
    detectedProblemTitle ??= problemOverride.detectedProblemTitle;
  }
  if (!problemOverride && auth) {
    try {
      const catalog = await loadCatalog(new GitHubClient(auth.token, fetchForAuth(auth)));
      const resolved = resolveCatalogProblem(catalog, provider, tab.url, detectedProblemId);
      if (resolved) {
        detectedProblemId = resolved.problem.problemId;
        detectedProblemTitle = resolved.problem.title;
      }
    } catch {
      // Keep the raw detection available if GitHub cannot be reached.
    }
  }
  return {
    tabId: tab.id,
    pageUrl: tab.url,
    contextKey,
    contextAliases: [...contextKeys].filter((key) => key !== contextKey),
    detected: {
      provider,
      problemId: detectedProblemId,
      problemTitle: detectedProblemTitle,
    },
    problemOverride,
  };
}

async function refreshProblemMetadata(item: SubmissionQueueItem): Promise<void> {
  if (item.problemOverride || item.provider !== "swea" || !Number.isInteger(item.tabId)) return;
  const hasCapturedFrame = Number.isInteger(item.frameId);
  const preferredFrame = hasCapturedFrame ? item.frameId! : 0;
  let metadata: { problemIdHint?: string; pageTitle?: string } | undefined;
  try {
    metadata = await chrome.tabs.sendMessage(
      item.tabId,
      { type: "problem-metadata:get" },
      { frameId: preferredFrame },
    );
  } catch {
    // The content script may not be installed in a tab that stayed open across an extension reload.
  }
  const targets = hasCapturedFrame
    ? [...new Set([preferredFrame, 0])].map((frameId) => ({ tabId: item.tabId, frameIds: [frameId] }))
    : [{ tabId: item.tabId, allFrames: true }];
  for (const target of targets) {
    if (metadata?.problemIdHint) break;
    try {
      const execution = await chrome.scripting.executeScript({
        target,
        func: readSweaProblemMetadata,
      });
      metadata = execution?.map((entry: any) => entry.result)
        .find((result: any) => typeof result?.problemIdHint === "string");
    } catch {
      // Keep the queued metadata when the original tab or frame is no longer available.
    }
  }
  if (typeof metadata?.problemIdHint === "string") item.problemIdHint = metadata.problemIdHint;
  if (typeof metadata?.pageTitle === "string" && metadata.pageTitle.trim()) item.pageTitle = metadata.pageTitle.trim();
}

async function captureAttempt(message: any, sender: any): Promise<any> {
  const tabId = sender.tab?.id;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const senderUrl = sender.tab?.url ?? sender.url;
  const frameUrl = typeof sender.url === "string" ? sender.url : senderUrl;
  const provider = providerForUrl(senderUrl);
  if (!Number.isInteger(tabId) || !provider || provider !== message.provider) {
    throw new Error("지원하지 않는 탭에서 제출 캡처를 요청했습니다.");
  }
  const execution = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: "MAIN",
    func: readEditorSnapshot,
    args: [provider],
  });
  const snapshot = execution?.[0]?.result as EditorSnapshot | undefined;
  if (!snapshot?.code?.trim()) throw new Error("코드 편집기에서 제출 코드를 읽지 못했습니다.");
  const pageTitle = String(message.pageTitle ?? "");
  const contextKey = problemContextKey(provider, frameUrl, pageTitle)
    ?? problemContextKey(provider, senderUrl, pageTitle);
  const overrides = await getProblemOverrides();
  const id = crypto.randomUUID();
  const attempt: PendingAttempt = {
    id,
    provider,
    problemIdHint: typeof message.problemIdHint === "string" ? message.problemIdHint : undefined,
    problemContextKey: contextKey,
    problemOverride: contextKey ? overrides[contextKey] : undefined,
    pageTitle,
    pageUrl: senderUrl,
    tabId,
    frameId,
    capturedAt: new Date().toISOString(),
    code: snapshot.code,
    language: snapshot.language || String(message.languageHint ?? ""),
  };
  const pending = await getPendingAttempts();
  pending[String(tabId)] = attempt;
  await setStored(storageKeys.pendingAttempts, pending);
  return { ok: true, attemptId: id };
}

async function acceptAttempt(sender: any): Promise<any> {
  const tabId = sender.tab?.id;
  const senderUrl = sender.tab?.url ?? sender.url;
  if (!Number.isInteger(tabId) || !providerForUrl(senderUrl)) throw new Error("지원하지 않는 탭입니다.");
  const pending = await getPendingAttempts();
  const attempt = pending[String(tabId)];
  if (!attempt || Date.now() - Date.parse(attempt.capturedAt) > 10 * 60 * 1000) {
    throw new Error("Accepted 결과에 대응하는 최근 제출 코드를 찾지 못했습니다.");
  }
  delete pending[String(tabId)];
  await setStored(storageKeys.pendingAttempts, pending);
  const item = await enqueueAccepted(attempt);
  void runSynchronization().then(async () => {
    const [queue, history] = await Promise.all([getPendingQueue(), getSyncHistory()]);
    const updated = queue.find((candidate) => candidate.id === item.id)
      ?? history.find((candidate) => candidate.id === item.id);
    if (updated) {
      void chrome.tabs.sendMessage(tabId, {
        type: "sync-status",
        status: updated.status,
        message: updated.status === "synced"
          ? `${updated.problemTitle ?? "풀이"}를 Draft PR에 올렸습니다.`
          : updated.error ?? "풀이를 로컬 큐에 보관했습니다.",
        prUrl: updated.prUrl,
      }).catch(() => undefined);
    }
  });
  return { ok: true, status: "pending" };
}

async function publicState(): Promise<any> {
  let [auth, deviceSession, queue, history, pullSnapshots, settings, syncActivity] = await Promise.all([
    getAuth(), getDeviceSession(), getPendingQueue(), getSyncHistory(), getPullSnapshots(), getSettings(), getSyncActivity(),
  ]);
  let today = toSeoulDate(new Date()).date;
  let todayPull: DailyPullRequest | undefined = pullSnapshots[today];
  if (auth) {
    try {
      const refreshed = await refreshTodayPull(auth, new GitHubClient(auth.token, fetchForAuth(auth)), pullSnapshots);
      today = refreshed.date;
      todayPull = refreshed.pull;
    } catch (error) {
      if (isGitHubUnauthorized(error)) auth = await getAuth();
      // Keep the cached record available when GitHub cannot be reached.
    }
  }
  const activeProblem = auth ? await getActiveProblem(auth) : undefined;
  const recentSubmissions = [...history, ...queue.map(({ code: _code, ...item }) => item)]
    .sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt))
    .slice(-20);
  return {
    auth: auth ? { login: auth.login, avatarUrl: auth.avatarUrl } : undefined,
    deviceSession,
    queue: recentSubmissions,
    activeProblem,
    today,
    todayPull,
    settings,
    syncActivity,
  };
}

async function handleMessage(message: any, sender: any): Promise<any> {
  switch (message?.type) {
    case "state:get":
      return publicState();
    case "auth:start": {
      const session = await startDeviceFlow();
      await setStored(storageKeys.deviceSession, session);
      chrome.alarms.create(AUTH_ALARM, { delayInMinutes: 0.1, periodInMinutes: 0.5 });
      await chrome.tabs.create({ url: session.verificationUri });
      return publicState();
    }
    case "auth:poll":
      await pollAuthentication();
      return publicState();
    case "auth:logout": {
      const queue = await getPendingQueue();
      if (queue.length > 0 && !message.force) return { needsConfirmation: true };
      await Promise.all([
        removeStored(storageKeys.auth),
        removeStored(storageKeys.branchClaims),
        removeStored(storageKeys.deviceSession),
        removeStored(storageKeys.pendingAttempts),
        removeStored(storageKeys.pullSnapshots),
        removeStored(storageKeys.syncHistory),
        removeStored(storageKeys.syncActivity),
        message.force ? setStored(storageKeys.pendingQueue, []) : Promise.resolve(),
      ]);
      return publicState();
    }
    case "capture-attempt":
      return captureAttempt(message, sender);
    case "submission-accepted":
      return acceptAttempt(sender);
    case "queue:retry": {
      const queue = await getPendingQueue();
      for (const item of queue) {
        if (item.status === "blocked" || item.status === "pending") {
          if (!item.problemOverride && item.provider === "swea" && item.error?.includes("카탈로그")) {
            await refreshProblemMetadata(item);
          }
          item.status = "pending";
          item.error = undefined;
          item.blockReason = undefined;
          item.retryAt = undefined;
        }
      }
      await setStored(storageKeys.pendingQueue, queue);
      await runSynchronization();
      return publicState();
    }
    case "queue:problem-override": {
      const auth = await getAuth();
      if (!auth) throw new Error("GitHub 로그인이 필요합니다.");
      if (typeof message.itemId !== "string") throw new Error("수정할 제출 정보가 올바르지 않습니다.");
      if (!["leetcode", "programmers", "swea"].includes(message.provider)) {
        throw new Error("지원하지 않는 공급자입니다.");
      }
      if (typeof message.problemId !== "string") throw new Error("문제 번호가 올바르지 않습니다.");
      await saveProblemOverride(auth, message.itemId, message.provider as Provider, message.problemId, fetchForAuth(auth));
      await runSynchronization();
      return publicState();
    }
    case "queue:problem-override:clear": {
      if (typeof message.itemId !== "string") throw new Error("수정할 제출 정보가 올바르지 않습니다.");
      await clearProblemOverride(message.itemId);
      await runSynchronization();
      return publicState();
    }
    case "active-problem:override": {
      const auth = await getAuth();
      if (!auth) throw new Error("GitHub 로그인이 필요합니다.");
      if (!["leetcode", "programmers", "swea"].includes(message.provider)) {
        throw new Error("지원하지 않는 공급자입니다.");
      }
      if (typeof message.problemId !== "string" || typeof message.contextKey !== "string") {
        throw new Error("현재 문제 정보가 올바르지 않습니다.");
      }
      const activeProblem = await getActiveProblem(auth);
      if (!activeProblem || activeProblem.contextKey !== message.contextKey) {
        throw new Error("현재 열린 문제가 변경되었습니다. 팝업을 다시 열어 확인하세요.");
      }
      await saveActiveProblemOverride(
        auth,
        activeProblem,
        message.provider as Provider,
        message.problemId,
        fetchForAuth(auth),
      );
      await runSynchronization();
      return publicState();
    }
    case "active-problem:override:clear": {
      if (typeof message.contextKey !== "string") throw new Error("현재 문제 정보가 올바르지 않습니다.");
      const activeProblem = await getActiveProblem(await getAuth());
      if (!activeProblem || activeProblem.contextKey !== message.contextKey) {
        throw new Error("현재 열린 문제가 변경되었습니다. 팝업을 다시 열어 확인하세요.");
      }
      await clearActiveProblemOverride([activeProblem.contextKey, ...activeProblem.contextAliases]);
      await runSynchronization();
      return publicState();
    }
    case "settings:update": {
      if (typeof message.autoReadyAfterMidnight !== "boolean") {
        throw new Error("자동 Ready 전환 설정값이 올바르지 않습니다.");
      }
      await setStored(storageKeys.settings, {
        autoReadyAfterMidnight: message.autoReadyAfterMidnight,
      });
      if (message.autoReadyAfterMidnight) void runSynchronization();
      return publicState();
    }
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (value: any) => void) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "오류가 발생했습니다." }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  scheduleAlarms();
  void runSynchronization();
});
chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
  void pollAuthentication();
  void runSynchronization();
});
chrome.alarms.onAlarm.addListener((alarm: any) => {
  if (alarm.name === AUTH_ALARM) void pollAuthentication();
  if (alarm.name === SYNC_ALARM) void runSynchronization();
  if (alarm.name === CLOSE_ALARM) {
    chrome.alarms.create(CLOSE_ALARM, { when: nextSeoulMidnight(Date.now() + 60_000) });
    void runSynchronization();
  }
});

scheduleAlarms();
