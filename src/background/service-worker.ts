import { pollDeviceFlow, startDeviceFlow } from "./auth.js";
import {
  getAuth,
  getDailyPulls,
  getDeviceSession,
  getPendingAttempts,
  getQueue,
  getSettings,
  getSyncActivity,
  removeStored,
  setStored,
  storageKeys,
} from "./storage.js";
import { enqueueAccepted, synchronize } from "./sync.js";
import { GitHubClient } from "./github.js";
import { nextSeoulMidnight } from "../shared/date.js";
import { providerForUrl } from "../shared/catalog.js";
import type { EditorSnapshot, PendingAttempt, Provider, SyncProgressEvent } from "../shared/model.js";

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

async function runSynchronization(): Promise<void> {
  if (synchronization) return synchronization;
  const auth = await getAuth();
  if (!auth) return;
  synchronization = synchronize(auth, fetch, publishSyncProgress)
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
      await Promise.all([
        setStored(storageKeys.auth, result.auth),
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

async function captureAttempt(message: any, sender: any): Promise<any> {
  const tabId = sender.tab?.id;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const senderUrl = sender.tab?.url ?? sender.url;
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
  const id = crypto.randomUUID();
  const attempt: PendingAttempt = {
    id,
    provider,
    problemIdHint: typeof message.problemIdHint === "string" ? message.problemIdHint : undefined,
    pageTitle: String(message.pageTitle ?? ""),
    pageUrl: senderUrl,
    tabId,
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
    const updated = (await getQueue()).find((candidate) => candidate.id === item.id);
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
  const [auth, deviceSession, queue, dailyPulls, settings, syncActivity] = await Promise.all([
    getAuth(), getDeviceSession(), getQueue(), getDailyPulls(), getSettings(), getSyncActivity(),
  ]);
  return {
    auth: auth ? { login: auth.login, avatarUrl: auth.avatarUrl } : undefined,
    deviceSession,
    queue: queue.slice(-20).map(({ code: _code, ...item }) => item),
    dailyPulls,
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
      const queue = await getQueue();
      const unsynced = queue.some((item) => item.status !== "synced");
      if (unsynced && !message.force) return { needsConfirmation: true };
      await Promise.all([
        removeStored(storageKeys.auth),
        removeStored(storageKeys.deviceSession),
        removeStored(storageKeys.pendingAttempts),
        removeStored(storageKeys.syncActivity),
        message.force ? setStored(storageKeys.queue, queue.filter((item) => item.status === "synced")) : Promise.resolve(),
      ]);
      return publicState();
    }
    case "capture-attempt":
      return captureAttempt(message, sender);
    case "submission-accepted":
      return acceptAttempt(sender);
    case "queue:retry": {
      const queue = await getQueue();
      for (const item of queue) {
        if (item.status === "blocked" || item.status === "pending") {
          item.status = "pending";
          item.error = undefined;
          item.retryAt = undefined;
        }
      }
      await setStored(storageKeys.queue, queue);
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
