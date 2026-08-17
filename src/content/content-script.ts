type Provider = "leetcode" | "programmers" | "swea";

function activePageUrl(): URL {
  const current = new URL(location.href);
  if (current.protocol === "http:" || current.protocol === "https:") return current;
  try {
    if (window.top?.location.href) return new URL(window.top.location.href);
  } catch {
    // Fall through to the embedding document URL.
  }
  return new URL(document.referrer || location.href);
}

const url = activePageUrl();
const provider: Provider | undefined = url.hostname.includes("leetcode.com")
  ? "leetcode"
  : url.hostname === "school.programmers.co.kr"
    ? "programmers"
    : url.hostname.includes("swexpertacademy.com")
      ? "swea"
      : undefined;

let armedAt = 0;
let acceptedSent = false;
let mutationTimer: number | undefined;
let acceptedBaseline = "";
let sawResultReset = false;
let capturePromise: Promise<boolean> | undefined;

function buttonText(element: Element): string {
  return [
    element.textContent,
    element.getAttribute("value"),
    element.getAttribute("title"),
    element.getAttribute("aria-label"),
  ].filter(Boolean).join(" ").replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function isSubmitControl(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const control = element.closest("button, [role='button'], input[type='submit'], input[type='button'], input[type='image'], a");
  if (!control) return false;
  const text = buttonText(control);
  const marker = `${control.id} ${control.className} ${control.getAttribute("data-e2e-locator") ?? ""}`.toLowerCase();
  if (provider === "leetcode") return /submit|제출/.test(`${text} ${marker}`);
  if (provider === "programmers") return /제출 후 채점|코드 채점|submit/.test(`${text} ${marker}`);
  return /제출|submit/.test(`${text} ${marker}`);
}

function languageHint(): string {
  const selectors = provider === "swea" ? [
    "select[name*='language' i] option:checked",
    "select[id*='language' i] option:checked",
    "select[name*='codeLang' i] option:checked",
    "select[id*='codeLang' i] option:checked",
  ] : [
    "select option:checked",
    "[data-e2e-locator*='lang']",
    "[data-cy='lang-select']",
    "button[id*='lang']",
  ];
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text && text.length < 40) return text;
  }
  return "";
}

function problemIdHint(): string | undefined {
  if (provider !== "swea") return undefined;
  const query = url.searchParams.get("problemId") ?? url.searchParams.get("problemTitle");
  const queryMatch = /^\s*(\d{1,8})(?:\s*\.|\s|$)/.exec(query ?? "");
  if (queryMatch) return queryMatch[1];
  let problemDocument = document;
  try {
    if (window.top?.document) problemDocument = window.top.document;
  } catch {
    // Cross-origin frames can only inspect their own document.
  }
  const selectors = [
    "h1, h2, h3, h4",
    "[class*='problem'] [class*='title']",
    "[class*='problem'][class*='title']",
    "[id*='problem'][id*='title']",
    "[class*='problem'] [class*='num']",
    ".week_num",
  ];
  for (const selector of selectors) {
    for (const element of problemDocument.querySelectorAll(selector)) {
      for (const line of (element.textContent ?? "").split(/\r?\n/)) {
        const match = /^\s*(\d{3,8})\s*\.\s*\S/.exec(line);
        if (match) return match[1];
      }
    }
  }
  const bodyMatch = /(?:^|\n)\s*(\d{3,8})\s*\.\s*\S/m.exec(problemDocument.body?.innerText ?? "");
  return bodyMatch?.[1];
}

function problemPageTitle(): string {
  if (provider !== "swea") return document.title;
  let problemDocument = document;
  try {
    if (window.top?.document) problemDocument = window.top.document;
  } catch {
    // Cross-origin frames can only inspect their own document.
  }
  const problemId = problemIdHint();
  if (problemId) {
    const pattern = new RegExp(`^\\s*${problemId}\\s*\\.\\s*\\S`);
    for (const element of problemDocument.querySelectorAll("h1, h2, h3, h4, [class*='problem'] [class*='title'], [class*='problem'][class*='title']")) {
      const title = (element.textContent ?? "").split(/\r?\n/).map((line) => line.trim()).find((line) => pattern.test(line));
      if (title) return title;
    }
  }
  return problemDocument.title || document.title;
}

function showToast(message: string, status: "info" | "success" | "error" = "info", link?: string): void {
  document.getElementById("leetdash-extension-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "leetdash-extension-toast";
  Object.assign(toast.style, {
    position: "fixed",
    zIndex: "2147483647",
    right: "20px",
    bottom: "20px",
    maxWidth: "360px",
    padding: "12px 16px",
    borderRadius: "10px",
    color: "white",
    background: status === "success" ? "#15803d" : status === "error" ? "#b91c1c" : "#1f2937",
    boxShadow: "0 8px 28px rgba(0,0,0,.28)",
    font: "13px/1.5 system-ui, sans-serif",
  });
  toast.textContent = message;
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = " PR 열기";
    anchor.style.color = "#bfdbfe";
    anchor.style.marginLeft = "8px";
    toast.append(anchor);
  }
  document.documentElement.append(toast);
  window.setTimeout(() => toast.remove(), 8000);
}

async function armCapture(): Promise<boolean> {
  if (!provider) return false;
  armedAt = Date.now();
  acceptedSent = false;
  acceptedBaseline = acceptedText();
  sawResultReset = !hasAcceptedResult(acceptedBaseline);
  const pageTitle = problemPageTitle();
  const response = await chrome.runtime.sendMessage({
    type: "capture-attempt",
    provider,
    problemIdHint: problemIdHint(),
    pageTitle,
    languageHint: languageHint(),
  });
  if (response?.ok === false) {
    showToast(response.error, "error");
    return false;
  }
  return true;
}

function startCapture(): Promise<boolean> {
  if (capturePromise && Date.now() - armedAt < 2_000) return capturePromise;
  capturePromise = armCapture();
  return capturePromise;
}

function acceptedText(): string {
  const selectors = [
    "[data-e2e-locator*='submission-result']",
    "[data-e2e-locator*='result']",
    "[class*='result']",
    "[class*='Result']",
    "[role='dialog']",
    "[role='alert']",
    ".modal",
  ];
  return selectors
    .flatMap((selector) => [...document.querySelectorAll(selector)].slice(-5))
    .map((element) => element.textContent ?? "")
    .join("\n")
    .slice(-12000);
}

function hasAcceptedResult(text: string): boolean {
  if (provider === "leetcode") return /\bAccepted\b|정답입니다|통과했습니다/i.test(text);
  if (provider === "programmers") return /정확성\s*:\s*100(?:\.0+)?|합계\s*:\s*100(?:\.0+)?|테스트를 통과|정답입니다/i.test(text);
  return /\bAccepted\b|\bPass\b|정답입니다|모든 테스트케이스를 통과/i.test(text);
}

async function reportAccepted(): Promise<void> {
  if (!armedAt || acceptedSent || Date.now() - armedAt > 10 * 60 * 1000) return;
  if (capturePromise && !(await capturePromise)) return;
  if (acceptedSent) return;
  acceptedSent = true;
  const response = await chrome.runtime.sendMessage({ type: "submission-accepted" });
  if (response?.ok === false) {
    acceptedSent = false;
    showToast(response.error, "error");
    return;
  }
  showToast("Accepted 풀이를 leetdash 업로드 큐에 저장했습니다.");
}

async function inspectResult(): Promise<void> {
  if (!armedAt || acceptedSent || Date.now() - armedAt > 10 * 60 * 1000) return;
  const resultText = acceptedText();
  if (!hasAcceptedResult(resultText)) {
    sawResultReset = true;
    return;
  }
  if (!sawResultReset && resultText === acceptedBaseline) return;
  await reportAccepted();
}

if (provider) {
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && isSubmitControl(event.target)) void startCapture();
  }, true);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void startCapture();
  }, true);
  window.addEventListener("message", (event) => {
    if (
      provider !== "swea"
      || event.source !== window
      || event.origin !== url.origin
      || event.data?.source !== "leetdash-swea-page-hook"
    ) return;
    if (event.data.type === "submission-started") void startCapture();
    if (event.data.type === "submission-accepted") void reportAccepted();
  });
  new MutationObserver(() => {
    if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => { void inspectResult(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response: any) => void) => {
    if (message?.type === "sync-status") {
      showToast(message.message, message.status === "synced" ? "success" : "error", message.prUrl);
    }
    if (message?.type === "problem-metadata:get") {
      sendResponse({ problemIdHint: problemIdHint(), pageTitle: problemPageTitle() });
    }
  });
}
