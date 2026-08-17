interface PopupState {
  auth?: { login: string; avatarUrl?: string };
  deviceSession?: {
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    error?: string;
  };
  queue: Array<{
    id: string;
    provider: "leetcode" | "programmers" | "swea";
    problemIdHint?: string;
    pageTitle: string;
    status: string;
    problemId?: string;
    problemTitle?: string;
    problemOverride?: {
      provider: "leetcode" | "programmers" | "swea";
      problemId: string;
      problemTitle: string;
      updatedAt: string;
    };
    error?: string;
    prUrl?: string;
  }>;
  today: string;
  todayPull?: { url: string; state: "draft" | "ready" | "closed" | "merged" };
  settings: {
    autoReadyAfterMidnight: boolean;
  };
  syncActivity?: {
    itemId: string;
    title: string;
    stage: "catalog" | "user" | "fork" | "branch" | "commit" | "pull-request" | "complete";
    status: "running" | "completed" | "failed";
    message: string;
    startedAt: string;
    updatedAt: string;
  };
  error?: string;
}

const app = document.querySelector<HTMLElement>("#app")!;
const usersFileUrl = "https://github.com/whoisyourbias/leetdash/blob/master/data/users.json";
let pollingTimer: number | undefined;
let refreshScheduled = false;

const syncSteps = [
  { stage: "catalog", label: "문제 확인" },
  { stage: "user", label: "사용자 확인" },
  { stage: "fork", label: "저장소 fork" },
  { stage: "branch", label: "날짜 브랜치" },
  { stage: "commit", label: "풀이 커밋" },
  { stage: "pull-request", label: "Draft PR" },
] as const;

const providerLabels = {
  leetcode: "LeetCode",
  programmers: "Programmers",
  swea: "SWEA",
} as const;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  return result;
}

function button(label: string, onClick: () => void, className = "button"): HTMLButtonElement {
  const result = element("button", className);
  result.type = "button";
  result.textContent = label;
  result.addEventListener("click", onClick);
  return result;
}

async function send(type: string, payload: Record<string, unknown> = {}): Promise<PopupState | any> {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function appendUsersFileLink(root: HTMLElement): void {
  const link = element("a");
  link.href = usersFileUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "whoisyourbias/leetdash의 data/users.json 열기";
  root.append(link);
}

function renderSettings(state: PopupState, root: HTMLElement): void {
  const card = element("section", "settings-card");
  const heading = element("div", "setting-heading");
  const copy = element("div");
  const title = element("strong");
  title.textContent = "자정 이후 자동 Ready 전환";
  const description = element("p", "muted setting-description");
  description.textContent = "KST 날짜가 바뀌고 미동기화 풀이가 없으면 지난 날짜의 Draft PR을 Ready로 바꿉니다.";
  copy.append(title, description);

  const toggle = element("input", "setting-toggle");
  toggle.type = "checkbox";
  toggle.checked = state.settings.autoReadyAfterMidnight;
  toggle.setAttribute("aria-label", "자정 이후 Draft PR 자동 Ready 전환");
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    render(await send("settings:update", { autoReadyAfterMidnight: toggle.checked }));
  });
  heading.append(copy, toggle);

  const registration = element("div", "registration-note");
  const registrationText = element("p", "muted");
  registrationText.textContent = "참가자 등록 기준은 중앙 Leetdash 저장소의 사용자 파일입니다.";
  registration.append(registrationText);
  appendUsersFileLink(registration);
  card.append(heading, registration);
  root.append(card);
}

function renderSyncActivity(state: PopupState, root: HTMLElement): void {
  const activity = state.syncActivity;
  if (!activity) return;
  const card = element("section", `sync-card sync-${activity.status}`);
  const header = element("div", "sync-header");
  const heading = element("div");
  const eyebrow = element("span", "sync-eyebrow");
  eyebrow.textContent = activity.status === "running" ? "현재 처리 중" : "최근 동기화";
  const title = element("strong", "sync-title");
  title.textContent = activity.title;
  heading.append(eyebrow, title);
  const badge = element("span", `sync-badge ${activity.status}`);
  badge.textContent = activity.status === "running" ? "진행 중" : activity.status === "completed" ? "완료" : "실패";
  header.append(heading, badge);

  const message = element("p", "sync-message");
  message.textContent = activity.message;
  const steps = element("ol", "sync-steps");
  const activeIndex = syncSteps.findIndex(({ stage }) => stage === activity.stage);
  syncSteps.forEach((step, index) => {
    const row = element("li", "sync-step");
    let stepStatus = "waiting";
    if (activity.status === "completed" || activity.stage === "complete" || index < activeIndex) stepStatus = "done";
    if (index === activeIndex && activity.status === "running") stepStatus = "active";
    if (index === activeIndex && activity.status === "failed") stepStatus = "failed";
    row.classList.add(stepStatus);
    const marker = element("span", "sync-step-marker");
    marker.textContent = stepStatus === "done" ? "✓" : stepStatus === "failed" ? "!" : String(index + 1);
    const label = element("span");
    label.textContent = step.label;
    row.append(marker, label);
    steps.append(row);
  });
  card.append(header, message, steps);
  root.append(card);
}

function renderQueue(state: PopupState, root: HTMLElement): void {
  const heading = element("div", "section-heading");
  heading.textContent = "최근 제출";
  root.append(heading);
  const queue = element("div", "queue");
  if (state.queue.length === 0) {
    const empty = element("p", "muted");
    empty.textContent = "Accepted 제출을 기다리고 있습니다.";
    queue.append(empty);
  }
  for (const item of [...state.queue].reverse()) {
    const row = element("div", `queue-item status-${item.status}`);
    const title = element("div", "queue-title");
    title.textContent = item.problemTitle ?? item.pageTitle ?? item.provider;
    const status = element("div", "queue-status");
    status.textContent = item.error
      ?? (item.status === "syncing" && state.syncActivity?.itemId === item.id ? state.syncActivity.message : undefined)
      ?? ({ pending: "동기화 대기", syncing: "업로드 중", synced: "업로드 완료", blocked: "확인 필요" }[item.status] ?? item.status);
    const metadata = element("dl", "problem-metadata");
    const detectedProviderLabel = element("dt");
    detectedProviderLabel.textContent = "감지 공급자";
    const detectedProvider = element("dd");
    detectedProvider.textContent = providerLabels[item.provider];
    const detectedIdLabel = element("dt");
    detectedIdLabel.textContent = "감지 문제 번호";
    const detectedId = element("dd");
    detectedId.textContent = item.problemIdHint ?? "확인 못함";
    metadata.append(detectedProviderLabel, detectedProvider, detectedIdLabel, detectedId);
    if (item.problemOverride) {
      const appliedLabel = element("dt");
      appliedLabel.textContent = "적용 문제";
      const applied = element("dd", "manual-value");
      applied.textContent = `${providerLabels[item.problemOverride.provider]} ${item.problemOverride.problemId} · 사용자 지정`;
      metadata.append(appliedLabel, applied);
    } else if (item.status === "synced" && item.problemId) {
      const appliedLabel = element("dt");
      appliedLabel.textContent = "적용 문제";
      const applied = element("dd");
      applied.textContent = `${providerLabels[item.provider]} ${item.problemId}`;
      metadata.append(appliedLabel, applied);
    }
    row.append(title, status, metadata);
    if (item.status === "pending" || item.status === "blocked") {
      const editButton = button("문제 정보 수정", () => {
        editor.hidden = !editor.hidden;
        editButton.textContent = editor.hidden ? "문제 정보 수정" : "수정 닫기";
      }, "inline-button");
      const editor = element("div", "problem-editor");
      editor.hidden = true;
      const providerField = element("label");
      providerField.textContent = "공급자";
      const providerSelect = element("select");
      for (const provider of ["leetcode", "programmers", "swea"] as const) {
        const option = element("option");
        option.value = provider;
        option.textContent = providerLabels[provider];
        providerSelect.append(option);
      }
      providerSelect.value = item.problemOverride?.provider ?? item.provider;
      providerField.append(providerSelect);
      const idField = element("label");
      idField.textContent = "문제 번호";
      const idInput = element("input");
      idInput.type = "text";
      idInput.inputMode = "numeric";
      idInput.pattern = "[0-9]{1,8}";
      idInput.maxLength = 8;
      idInput.value = item.problemOverride?.problemId ?? item.problemIdHint ?? "";
      idField.append(idInput);
      const feedback = element("p", "editor-feedback");
      const actions = element("div", "editor-actions");
      const save = button("저장 후 동기화", async () => {
        const problemId = idInput.value.trim();
        if (!/^\d{1,8}$/.test(problemId)) {
          feedback.textContent = "문제 번호는 1~8자리 숫자로 입력하세요.";
          return;
        }
        save.disabled = true;
        feedback.textContent = "카탈로그를 확인하는 중입니다.";
        const result = await send("queue:problem-override", {
          itemId: item.id,
          provider: providerSelect.value,
          problemId,
        });
        if (result?.ok === false) {
          save.disabled = false;
          feedback.textContent = result.error;
          return;
        }
        render(result);
      }, "inline-button primary");
      actions.append(save);
      if (item.problemOverride) {
        actions.append(button("자동 감지로 되돌리기", async () => {
          const result = await send("queue:problem-override:clear", { itemId: item.id });
          if (result?.ok === false) {
            feedback.textContent = result.error;
            return;
          }
          render(result);
        }, "inline-button subtle"));
      }
      editor.append(providerField, idField, feedback, actions);
      row.append(editButton, editor);
    }
    if (item.prUrl) {
      const link = element("a");
      link.href = item.prUrl;
      link.target = "_blank";
      link.textContent = "Draft PR 열기";
      row.append(link);
    }
    queue.append(row);
  }
  root.append(queue);
  if (state.queue.some((item) => item.status === "pending" || item.status === "blocked")) {
    const retry = button(
      state.syncActivity?.status === "running" ? "동기화 진행 중" : "다시 동기화",
      async () => render(await send("queue:retry")),
      "button secondary",
    );
    retry.disabled = state.syncActivity?.status === "running";
    root.append(retry);
  }
}

function render(state: PopupState): void {
  app.replaceChildren();
  const header = element("header");
  const brand = element("div", "brand");
  const logo = element("img");
  logo.src = "icon.png";
  logo.alt = "";
  const title = element("div");
  title.innerHTML = "<strong>Leetdash</strong><span>Accepted → Draft PR</span>";
  brand.append(logo, title);
  header.append(brand);
  app.append(header);

  if (state.error) {
    const error = element("p", "notice error");
    error.textContent = state.error;
    app.append(error);
  }

  if (!state.auth) {
    const intro = element("p", "intro");
    intro.textContent = "GitHub에 로그인하면 LeetCode, Programmers, SWEA의 Accepted 풀이를 날짜별 Draft PR에 자동으로 올립니다.";
    app.append(intro);
    const registration = element("section", "registration-card");
    const registrationTitle = element("strong");
    registrationTitle.textContent = "사용 전 참가자 등록이 필요합니다";
    const registrationDescription = element("p", "muted");
    registrationDescription.textContent = "로그인할 GitHub 계정이 중앙 Leetdash 저장소의 사용자 파일에 등록되어 있어야 합니다.";
    registration.append(registrationTitle, registrationDescription);
    appendUsersFileLink(registration);
    app.append(registration);
    if (state.deviceSession) {
      const card = element("section", "device-card");
      const label = element("p", "muted");
      label.textContent = state.deviceSession.error ?? "GitHub 페이지에서 아래 코드를 입력하세요.";
      const code = element("code", "device-code");
      code.textContent = state.deviceSession.userCode;
      const link = element("a", "button");
      link.href = state.deviceSession.verificationUri;
      link.target = "_blank";
      link.textContent = "GitHub 인증 페이지 열기";
      card.append(label, code, link);
      if (state.deviceSession.error) {
        card.append(button("로그인 다시 시작", async () => render(await send("auth:start")), "button secondary"));
      }
      app.append(card);
      if (!state.deviceSession.error && pollingTimer === undefined) {
        pollingTimer = window.setInterval(async () => render(await send("auth:poll")), 5000);
      }
    } else {
      app.append(button("GitHub 로그인", async () => render(await send("auth:start"))));
    }
    return;
  }

  if (pollingTimer !== undefined) {
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
  const account = element("section", "account");
  if (state.auth.avatarUrl) {
    const avatar = element("img");
    avatar.src = state.auth.avatarUrl;
    avatar.alt = "";
    account.append(avatar);
  }
  const identity = element("div");
  const signed = element("span", "muted");
  signed.textContent = "GitHub 연결됨";
  const login = element("strong");
  login.textContent = state.auth.login;
  identity.append(signed, login);
  account.append(identity);
  app.append(account);

  renderSettings(state, app);

  renderSyncActivity(state, app);

  if (state.todayPull) {
    const pull = state.todayPull;
    const card = element("section", "pull-card");
    const pullState = element("span", `pill ${pull.state}`);
    pullState.textContent = ({ draft: "Draft", ready: "Ready", closed: "Closed", merged: "Merged" })[pull.state];
    const link = element("a");
    link.href = pull.url;
    link.target = "_blank";
    link.textContent = `${state.today} PR`;
    card.append(link, pullState);
    app.append(card);
  }

  renderQueue(state, app);
  app.append(button("로그아웃", async () => {
    let result = await send("auth:logout");
    if (result.needsConfirmation && window.confirm("아직 GitHub에 올라가지 않은 코드가 있습니다. 로컬 큐와 함께 삭제하고 로그아웃할까요?")) {
      result = await send("auth:logout", { force: true });
    }
    if (!result.needsConfirmation) render(result);
  }, "link-button"));
}

void send("state:get").then(render);

chrome.storage.onChanged.addListener((changes: Record<string, unknown>, areaName: string) => {
  if (areaName !== "local" || refreshScheduled) return;
  if (!["pendingQueue", "syncHistory", "pullSnapshots", "settings", "syncActivity", "auth"].some((key) => key in changes)) return;
  refreshScheduled = true;
  window.setTimeout(() => {
    refreshScheduled = false;
    void send("state:get").then(render);
  }, 80);
});
