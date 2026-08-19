import { decodeBase64Utf8, encodeBase64Utf8 } from "../shared/crypto.js";
import { isSolutionFilename } from "../shared/languages.js";
import type { DailyPullRequest, ProblemCatalog, PullBlockReason, UsersFile } from "../shared/model.js";

export const UPSTREAM = "whoisyourbias/leetdash";
export const BASE_BRANCH = "master";

export function submissionBranch(login: string, compactDate: string): string {
  const [upstreamOwner] = UPSTREAM.split("/");
  return login.toLowerCase() === upstreamOwner.toLowerCase()
    ? `submissions/${login}/${compactDate}`
    : compactDate;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string>;
}

type OperationProgress = (message: string) => void | Promise<void>;

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
    public readonly blockReason?: PullBlockReason,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `https://api.github.com${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    // Browser-native fetch is an IDL method and must not be invoked with the
    // GitHubClient instance as its receiver inside a service worker.
    const response = await this.fetchImpl.call(globalThis, url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    if (!response.ok) {
      let providerMessage = "";
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.message === "string") providerMessage = parsed.message;
      } catch {
        // Never expose raw provider responses, which may contain sensitive values.
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const endpoint = `${method.toUpperCase()} ${url.pathname}`;
      throw new GitHubError(
        providerMessage
          ? `GitHub API ${response.status} (${endpoint}): ${providerMessage}`
          : `GitHub API 요청 실패 (${response.status}, ${endpoint})`,
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async readJsonFile<T>(repository: string, filePath: string, ref = BASE_BRANCH): Promise<T> {
    const url = new URL(`https://api.github.com/repos/${repository}/contents/${filePath}`);
    url.searchParams.set("ref", ref);
    const response = await this.fetchImpl.call(globalThis, url, {
      method: "GET",
      headers: {
        // The regular Contents response omits `content` for files over 1 MB.
        // Raw media works for the checked-in catalog, which is currently ~4.8 MB.
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const source = await response.text();
    if (!response.ok) {
      throw new GitHubError(`GitHub 저장소 파일을 읽지 못했습니다. (${response.status})`, response.status);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new GitHubError(`${filePath}가 유효한 JSON이 아닙니다.`, 502);
    }
    // Some Chromium/GitHub combinations return Contents metadata even when
    // the raw media type was requested. Files over 1 MB then have no inline
    // content, so follow the immutable blob SHA to retrieve the full file.
    if (parsed?.type === "file" && typeof parsed.sha === "string") {
      const blob = await this.request<{ content?: string; encoding?: string }>(
        "GET",
        `/repos/${repository}/git/blobs/${parsed.sha}`,
      );
      if (blob.encoding !== "base64" || typeof blob.content !== "string" || !blob.content) {
        throw new GitHubError(`${filePath}의 Git blob 내용을 읽지 못했습니다.`, 502);
      }
      try {
        return JSON.parse(decodeBase64Utf8(blob.content)) as T;
      } catch {
        throw new GitHubError(`${filePath} Git blob이 유효한 JSON이 아닙니다.`, 502);
      }
    }
    return parsed as T;
  }

  readCatalog(): Promise<ProblemCatalog> {
    return this.readJsonFile<ProblemCatalog>(UPSTREAM, "data/problem-catalog.json");
  }

  readUsers(): Promise<UsersFile> {
    return this.readJsonFile<UsersFile>(UPSTREAM, "data/users.json");
  }

  async ensureFork(login: string, onProgress?: OperationProgress): Promise<string> {
    const repository = `${login}/leetdash`;
    if (repository.toLowerCase() === UPSTREAM.toLowerCase()) {
      await onProgress?.("원본 저장소 소유자이므로 fork 없이 원본 저장소를 사용합니다.");
      return UPSTREAM;
    }
    await onProgress?.("기존 GitHub fork를 확인하는 중입니다.");
    try {
      const existing = await this.request<any>("GET", `/repos/${repository}`);
      if (!existing.fork || existing.parent?.full_name?.toLowerCase() !== UPSTREAM.toLowerCase()) {
        throw new GitHubError(`${repository} 저장소가 leetdash fork가 아닙니다.`, 422);
      }
      await onProgress?.("기존 GitHub fork를 확인했습니다.");
      return repository;
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    }

    await onProgress?.("fork가 없어 GitHub에 생성을 요청하는 중입니다.");
    await this.request("POST", `/repos/${UPSTREAM}/forks`, { body: { default_branch_only: true } });
    await onProgress?.("GitHub가 fork 생성을 완료하기를 기다리는 중입니다.");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 + attempt * 500, 5000)));
      try {
        const fork = await this.request<any>("GET", `/repos/${repository}`);
        if (fork.fork && fork.parent?.full_name?.toLowerCase() === UPSTREAM.toLowerCase()) {
          await onProgress?.("새 GitHub fork가 준비되었습니다.");
          return repository;
        }
      } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 404) throw error;
      }
    }
    throw new GitHubError("GitHub fork 생성이 아직 완료되지 않았습니다.", 503, 30);
  }

  async ensureBranch(
    fork: string,
    branch: string,
    onProgress?: OperationProgress,
  ): Promise<{ created: boolean; atBase: boolean }> {
    const encoded = branch.split("/").map(encodeURIComponent).join("/");
    // Base the daily branch on the fork's own default branch. Copying the
    // upstream SHA into a stale fork can import workflow-file changes and
    // GitHub rejects that ref creation for the intentionally narrow
    // `public_repo` OAuth token. The PR still targets the current upstream
    // base, so only commits unique to this daily branch are proposed.
    await onProgress?.("fork의 기준 브랜치를 확인하는 중입니다.");
    const forkBaseRef = await this.request<any>("GET", `/repos/${fork}/git/ref/heads/${BASE_BRANCH}`);
    await onProgress?.(`${branch} 날짜 브랜치가 있는지 확인하는 중입니다.`);
    try {
      const existing = await this.request<any>("GET", `/repos/${fork}/git/ref/heads/${encoded}`);
      await onProgress?.(`${branch} 날짜 브랜치를 확인했습니다.`);
      return { created: false, atBase: existing.object.sha === forkBaseRef.object.sha };
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    }
    await onProgress?.(`${branch} 날짜 브랜치를 생성하는 중입니다.`);
    await this.request("POST", `/repos/${fork}/git/refs`, {
      body: { ref: `refs/heads/${branch}`, sha: forkBaseRef.object.sha },
    });
    await onProgress?.(`${branch} 날짜 브랜치를 생성했습니다.`);
    return { created: true, atBase: true };
  }

  async commitSolution({
    fork,
    branch,
    directory,
    extension,
    code,
    message,
    onProgress,
  }: {
    fork: string;
    branch: string;
    directory: string;
    extension: string;
    code: string;
    message: string;
    onProgress?: OperationProgress;
  }): Promise<{ changed: boolean; sha: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await onProgress?.("브랜치의 최신 커밋과 기존 풀이 파일을 확인하는 중입니다.");
      const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
      const ref = await this.request<any>("GET", `/repos/${fork}/git/ref/heads/${encodedBranch}`);
      const parentSha = ref.object.sha as string;
      const commit = await this.request<any>("GET", `/repos/${fork}/git/commits/${parentSha}`);
      const tree = await this.request<any>("GET", `/repos/${fork}/git/trees/${commit.tree.sha}`, {
        query: { recursive: "1" },
      });
      const existingSolutions = (tree.tree as any[]).filter((entry) => {
        if (entry.type !== "blob" || typeof entry.path !== "string") return false;
        const prefix = `${directory}/`;
        return entry.path.startsWith(prefix)
          && !entry.path.slice(prefix.length).includes("/")
          && isSolutionFilename(entry.path.slice(prefix.length));
      });
      const solutionPath = `${directory}/Solution.${extension}`;
      await onProgress?.("제출 코드를 GitHub blob으로 준비하는 중입니다.");
      const blob = await this.request<any>("POST", `/repos/${fork}/git/blobs`, {
        body: { content: encodeBase64Utf8(code), encoding: "base64" },
      });
      if (
        existingSolutions.length === 1
        && existingSolutions[0].path === solutionPath
        && existingSolutions[0].sha === blob.sha
      ) {
        await onProgress?.("동일한 풀이가 이미 브랜치에 반영되어 있습니다.");
        return { changed: false, sha: parentSha };
      }
      // Remove every old solution file from the directory and add the newly
      // submitted file. Keeping the target path out of the delete entries is
      // important: GitHub's tree API then replaces an existing solution file
      // at exactly the same path instead of leaving a stale copy behind.
      const entries = existingSolutions
        .map((entry) => ({
          path: entry.path,
          mode: "100644",
          type: "blob",
          sha: entry.path === solutionPath ? blob.sha : null,
        }));
      if (!existingSolutions.some((entry) => entry.path === solutionPath)) {
        entries.push({ path: solutionPath, mode: "100644", type: "blob", sha: blob.sha });
      }
      await onProgress?.("풀이 파일 변경 트리를 생성하는 중입니다.");
      const nextTree = await this.request<any>("POST", `/repos/${fork}/git/trees`, {
        body: { base_tree: commit.tree.sha, tree: entries },
      });
      await onProgress?.("풀이 커밋을 생성하는 중입니다.");
      const nextCommit = await this.request<any>("POST", `/repos/${fork}/git/commits`, {
        body: { message, tree: nextTree.sha, parents: [parentSha] },
      });
      try {
        await onProgress?.("날짜 브랜치에 새 커밋을 반영하는 중입니다.");
        await this.request("PATCH", `/repos/${fork}/git/refs/heads/${encodedBranch}`, {
          body: { sha: nextCommit.sha, force: false },
        });
        await onProgress?.("풀이 커밋을 날짜 브랜치에 반영했습니다.");
        return { changed: true, sha: nextCommit.sha };
      } catch (error) {
        if (!(error instanceof GitHubError) || ![409, 422].includes(error.status) || attempt === 2) throw error;
      }
    }
    throw new GitHubError("동시 커밋 충돌을 해결하지 못했습니다.", 409);
  }

  private async listPulls(login: string, branch: string, state: "open" | "all"): Promise<any[]> {
    const pulls = await this.request<unknown>("GET", `/repos/${UPSTREAM}/pulls`, {
      query: { base: BASE_BRANCH, head: `${login}:${branch}`, state, per_page: "100" },
    });
    if (!Array.isArray(pulls)) throw new GitHubError("GitHub PR 목록 응답 구조가 올바르지 않습니다.", 502);
    return pulls;
  }

  async findManagedPull(login: string, branch: string, date: string): Promise<DailyPullRequest | undefined> {
    const marker = `<!-- leetdash-extension:date=${date} -->`;
    const pulls = await this.listPulls(login, branch, "all");
    const pull = pulls.find((candidate) => candidate.head?.ref === branch && candidate.head?.user?.login === login);
    if (!pull) return undefined;
    if (typeof pull.body !== "string" || !pull.body.includes(marker)) {
      throw new GitHubError(`${branch} branch의 기존 PR은 확장 프로그램이 만든 PR이 아닙니다.`, 422);
    }
    return {
      date,
      compactDate: date.replaceAll("-", "").slice(2),
      branch,
      number: pull.number,
      nodeId: pull.node_id,
      url: pull.html_url,
      state: pull.merged_at
        ? "merged"
        : pull.state === "closed"
          ? "closed"
          : pull.draft
            ? "draft"
            : "ready",
    };
  }

  async findManagedDraftPull(login: string, branch: string, date: string): Promise<DailyPullRequest | undefined> {
    const pull = await this.findManagedPull(login, branch, date);
    if (pull?.state === "ready") {
      throw new GitHubError(`${branch} PR이 이미 Ready 상태입니다.`, 422, undefined, "pull_ready");
    }
    if (pull?.state === "closed") {
      throw new GitHubError(`${branch} 날짜 PR이 닫힌 상태입니다. GitHub에서 PR을 다시 열어주세요.`, 422, undefined, "pull_closed");
    }
    if (pull?.state === "merged") {
      throw new GitHubError(`${branch} 날짜 PR이 이미 병합되었습니다.`, 422, undefined, "pull_merged");
    }
    return pull;
  }

  async ensureDraftPull(
    login: string,
    branch: string,
    date: string,
    onProgress?: OperationProgress,
  ): Promise<DailyPullRequest> {
    const marker = `<!-- leetdash-extension:date=${date} -->`;
    const compactDate = date.replaceAll("-", "").slice(2);
    await onProgress?.("기존 Draft PR을 확인하는 중입니다.");
    const managed = await this.findManagedDraftPull(login, branch, date);
    if (managed) {
      await onProgress?.(`기존 Draft PR #${managed.number}을 사용합니다.`);
      return managed;
    }
    await onProgress?.("새 Draft PR을 생성하는 중입니다.");
    const pull = await this.request<any>("POST", `/repos/${UPSTREAM}/pulls`, {
      body: {
        base: BASE_BRANCH,
        head: `${login}:${branch}`,
        title: compactDate,
        draft: true,
        body: `${marker}\n\nChrome 확장 프로그램이 ${date}에 Accepted된 풀이를 누적합니다.`,
      },
    });
    await onProgress?.(`Draft PR #${pull.number}을 생성했습니다.`);
    return {
      date,
      compactDate,
      branch,
      number: pull.number,
      nodeId: pull.node_id,
      url: pull.html_url,
      state: "draft",
    };
  }

  async getPull(number: number): Promise<any> {
    return this.request("GET", `/repos/${UPSTREAM}/pulls/${number}`);
  }

  async markReady(nodeId: string): Promise<void> {
    const result = await this.request<any>("POST", "/graphql", {
      body: {
        query: "mutation MarkReady($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft url } } }",
        variables: { id: nodeId },
      },
    });
    if (result.errors?.length || result.data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false) {
      throw new GitHubError("Draft PR을 Ready로 전환하지 못했습니다.", 422);
    }
  }
}
