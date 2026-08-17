import { describe, expect, it, vi } from "vitest";

import { GitHubClient, submissionBranch } from "../src/background/github";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub daily submission orchestration", () => {
  it("uses an upstream namespace branch for the repository owner", async () => {
    expect(submissionBranch("whoisyourbias", "260817")).toBe("submissions/whoisyourbias/260817");
    expect(submissionBranch("ada", "260817")).toBe("260817");

    const fetchImpl = vi.fn();
    const progress: string[] = [];
    await expect(new GitHubClient("token", fetchImpl as typeof fetch).ensureFork(
      "whoisyourbias",
      (message) => progress.push(message),
    ))
      .resolves.toBe("whoisyourbias/leetdash");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(progress).toEqual(["원본 저장소 소유자이므로 fork 없이 원본 저장소를 사용합니다."]);
  });

  it("reads large checked-in JSON through the raw Contents media type", async () => {
    const largeCatalog = JSON.stringify({ lists: [{ key: "leetcode", padding: "x".repeat(1_100_000) }] });
    const fetchImpl = vi.fn(function (this: unknown, input: URL | RequestInfo, init: RequestInit = {}) {
      expect(this).toBe(globalThis);
      expect(new URL(String(input)).searchParams.get("ref")).toBe("master");
      expect((init.headers as Record<string, string>).Accept).toBe("application/vnd.github.raw+json");
      return Promise.resolve(new Response(largeCatalog, { status: 200 }));
    });
    const client = new GitHubClient("token", fetchImpl as typeof fetch);

    await expect(client.readJsonFile("whoisyourbias/leetdash", "data/problem-catalog.json"))
      .resolves.toMatchObject({ lists: [{ key: "leetcode" }] });
  });

  it("falls back to the Git blob when Chromium receives Contents metadata", async () => {
    const catalog = JSON.stringify({ lists: [{ key: "leetcode" }] });
    const encoded = btoa(catalog);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({
        type: "file",
        sha: "catalog-blob-sha",
        size: 4_815_987,
        content: "",
        encoding: "none",
      }))
      .mockResolvedValueOnce(response({ encoding: "base64", content: encoded }));
    const client = new GitHubClient("token", fetchImpl as typeof fetch);

    await expect(client.readJsonFile("whoisyourbias/leetdash", "data/problem-catalog.json"))
      .resolves.toEqual({ lists: [{ key: "leetcode" }] });
    expect(new URL(String(fetchImpl.mock.calls[1][0])).pathname)
      .toBe("/repos/whoisyourbias/leetdash/git/blobs/catalog-blob-sha");
  });

  it("invokes browser fetch with the global receiver", async () => {
    const fetchImpl = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(response({ login: "ada" }));
    });
    const client = new GitHubClient("token", fetchImpl as typeof fetch);

    await expect(client.request("GET", "/user")).resolves.toEqual({ login: "ada" });
  });

  it("reports the failed method and pathname without query values", async () => {
    const fetchImpl = vi.fn(async () => response({ message: "Not Found" }, 404));
    const client = new GitHubClient("token", fetchImpl as typeof fetch);

    await expect(client.request("GET", "/repos/ada/leetdash/git/ref/heads/260817", {
      query: { secret: "do-not-display" },
    })).rejects.toThrow(
      "GitHub API 404 (GET /repos/ada/leetdash/git/ref/heads/260817): Not Found",
    );
    await expect(client.request("GET", "/repos/ada/leetdash/git/ref/heads/260817", {
      query: { secret: "do-not-display" },
    })).rejects.not.toThrow("do-not-display");
  });

  it("creates a daily branch from the fork base without importing the upstream head", async () => {
    const requests: Array<{ url: URL; init: RequestInit; body: any }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url, init, body });
      if (url.pathname === "/repos/ada/leetdash/git/ref/heads/master") {
        return response({ object: { sha: "fork-base" } });
      }
      if (url.pathname === "/repos/ada/leetdash/git/ref/heads/260817") {
        return response({ message: "Not Found" }, 404);
      }
      if (url.pathname === "/repos/ada/leetdash/git/refs") return response({}, 201);
      throw new Error(`Unexpected request: ${init.method} ${url.pathname}`);
    });
    const client = new GitHubClient("token", fetchImpl as typeof fetch);

    const progress: string[] = [];
    await expect(client.ensureBranch("ada/leetdash", "260817", (message) => progress.push(message)))
      .resolves.toEqual({ created: true, atBase: true });
    expect(requests.map(({ url }) => url.pathname)).not.toContain(
      "/repos/whoisyourbias/leetdash/git/ref/heads/master",
    );
    expect(requests.find(({ url }) => url.pathname.endsWith("/git/refs"))?.body).toEqual({
      ref: "refs/heads/260817",
      sha: "fork-base",
    });
    expect(progress).toEqual([
      "fork의 기준 브랜치를 확인하는 중입니다.",
      "260817 날짜 브랜치가 있는지 확인하는 중입니다.",
      "260817 날짜 브랜치를 생성하는 중입니다.",
      "260817 날짜 브랜치를 생성했습니다.",
    ]);
  });

  it("replaces another language solution in one atomic tree commit", async () => {
    const requests: Array<{ url: URL; init: RequestInit; body: any }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url, init, body });
      if (url.pathname.endsWith("/git/ref/heads/260817")) return response({ object: { sha: "parent" } });
      if (url.pathname.endsWith("/git/commits/parent")) return response({ tree: { sha: "base-tree" } });
      if (url.pathname.endsWith("/git/trees/base-tree")) return response({
        tree: [{ type: "blob", path: "submissions/ada/leetcode/1/Solution.py", sha: "old" }],
      });
      if (url.pathname.endsWith("/git/blobs")) return response({ sha: "new-blob" }, 201);
      if (url.pathname.endsWith("/git/trees")) return response({ sha: "new-tree" }, 201);
      if (url.pathname.endsWith("/git/commits")) return response({ sha: "new-commit" }, 201);
      if (url.pathname.endsWith("/git/refs/heads/260817")) return response({ object: { sha: "new-commit" } });
      throw new Error(`Unexpected request: ${init.method} ${url.pathname}`);
    });
    const client = new GitHubClient("token", fetchImpl as typeof fetch);

    await expect(client.commitSolution({
      fork: "ada/leetdash",
      branch: "260817",
      directory: "submissions/ada/leetcode/1",
      extension: "java",
      code: "class Solution {}",
      message: "solve: leetcode 1",
    })).resolves.toEqual({ changed: true, sha: "new-commit" });

    const treeRequest = requests.find(({ url, init }) => url.pathname.endsWith("/git/trees") && init.method === "POST");
    expect(treeRequest?.body).toEqual({
      base_tree: "base-tree",
      tree: [
        { path: "submissions/ada/leetcode/1/Solution.py", mode: "100644", type: "blob", sha: null },
        { path: "submissions/ada/leetcode/1/Solution.java", mode: "100644", type: "blob", sha: "new-blob" },
      ],
    });
    expect(requests.find(({ url, init }) => url.pathname.endsWith("/git/refs/heads/260817") && init.method === "PATCH")?.body)
      .toEqual({ sha: "new-commit", force: false });
  });

  it("reuses the exact open Draft PR", async () => {
    const pull = {
      number: 17,
      node_id: "PR_node",
      html_url: "https://github.com/whoisyourbias/leetdash/pull/17",
      draft: true,
      body: "<!-- leetdash-extension:date=2026-08-17 -->",
      head: { ref: "260817", user: { login: "ada" } },
    };
    const fetchImpl = vi.fn(async () => response([pull]));
    const client = new GitHubClient("token", fetchImpl as typeof fetch);
    const progress: string[] = [];
    await expect(client.ensureDraftPull(
      "ada",
      "260817",
      "2026-08-17",
      (message) => progress.push(message),
    )).resolves.toEqual({
      date: "2026-08-17",
      compactDate: "260817",
      branch: "260817",
      number: 17,
      nodeId: "PR_node",
      url: pull.html_url,
      draft: true,
    });
    expect(progress).toEqual([
      "기존 Draft PR을 확인하는 중입니다.",
      "기존 Draft PR #17을 사용합니다.",
    ]);
  });

  it("reads an extension-managed Ready PR for popup display", async () => {
    const pull = {
      number: 17,
      node_id: "PR_node",
      html_url: "https://github.com/whoisyourbias/leetdash/pull/17",
      draft: false,
      body: "<!-- leetdash-extension:date=2026-08-17 -->",
      head: { ref: "260817", user: { login: "ada" } },
    };
    const client = new GitHubClient("token", vi.fn(async () => response([pull])) as typeof fetch);

    await expect(client.findManagedOpenPull("ada", "260817", "2026-08-17"))
      .resolves.toMatchObject({ number: 17, draft: false });
    await expect(client.findManagedDraftPull("ada", "260817", "2026-08-17"))
      .rejects.toThrow("Ready 상태");
  });

  it("refuses to reuse an unmarked Draft PR", async () => {
    const pull = {
      number: 17,
      node_id: "PR_node",
      html_url: "https://github.com/whoisyourbias/leetdash/pull/17",
      draft: true,
      body: "manual pull request",
      head: { ref: "260817", user: { login: "ada" } },
    };
    const client = new GitHubClient("token", vi.fn(async () => response([pull])) as typeof fetch);
    await expect(client.ensureDraftPull("ada", "260817", "2026-08-17"))
      .rejects.toThrow("확장 프로그램이 만든 PR이 아닙니다");
  });

  it("marks a Draft ready through the GraphQL mutation", async () => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      expect(body.variables).toEqual({ id: "PR_node" });
      expect(body.query).toContain("markPullRequestReadyForReview");
      return response({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
    });
    await expect(new GitHubClient("token", fetchImpl as typeof fetch).markReady("PR_node")).resolves.toBeUndefined();
  });
});
