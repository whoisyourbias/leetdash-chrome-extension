import type { Provider } from "./model.js";

export function visibleProblemId(value: string | null | undefined): string | undefined {
  return /^\s*(\d{1,8})(?:\s*\.|\s|$)/.exec(value ?? "")?.[1];
}

export function problemContextKey(
  provider: Provider,
  pageUrl: string,
  problemTitle?: string,
): string | undefined {
  const url = new URL(pageUrl);
  if (provider === "leetcode") {
    const slug = /^\/problems\/([^/]+)/.exec(url.pathname)?.[1];
    return slug ? `leetcode:slug:${slug.toLowerCase()}` : undefined;
  }
  if (provider === "programmers") {
    const problemId = /\/lessons\/(\d+)/.exec(url.pathname)?.[1];
    return problemId ? `programmers:problem:${problemId}` : undefined;
  }
  const normalizedTitle = problemTitle?.replaceAll(/\s+/g, " ").trim();
  if (normalizedTitle && /^\d{3,8}\s*\.\s*\S/.test(normalizedTitle)) {
    return `swea:title:${normalizedTitle.toLowerCase()}`;
  }
  const contestProblemId = url.searchParams.get("contestProbId")?.trim();
  if (contestProblemId) return `swea:contest:${contestProblemId}`;
  const queryProblemId = visibleProblemId(url.searchParams.get("problemId") ?? url.searchParams.get("problemTitle"));
  if (queryProblemId) return `swea:problem:${queryProblemId}`;
  return undefined;
}
