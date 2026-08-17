import type { CatalogProblem, ProblemCatalog, Provider } from "./model.js";

const canonicalSource: Record<Provider, string> = {
  leetcode: "leetcode",
  programmers: "programmers",
  swea: "swea",
};

function numericProblemId(value: string | null | undefined): string | undefined {
  const match = /^\s*(\d{1,8})(?:\s*\.|\s|$)/.exec(value ?? "");
  return match?.[1];
}

function locator(
  provider: Provider,
  pageUrl: string,
  problemIdHint?: string,
): { problemId?: string; slug?: string } {
  const url = new URL(pageUrl);
  if (provider === "leetcode") {
    const match = /^\/problems\/([^/]+)/.exec(url.pathname);
    return { slug: match?.[1] };
  }
  if (provider === "programmers") {
    const match = /\/lessons\/(\d+)/.exec(url.pathname);
    return { problemId: match?.[1] };
  }
  return {
    problemId: numericProblemId(url.searchParams.get("problemId"))
      ?? numericProblemId(url.searchParams.get("problemTitle"))
      ?? numericProblemId(problemIdHint),
  };
}

export function resolveCatalogProblem(
  catalog: ProblemCatalog,
  provider: Provider,
  pageUrl: string,
  problemIdHint?: string,
): { sourceKey: string; submissionKey: string; problem: CatalogProblem } | undefined {
  if (!Array.isArray(catalog?.lists)) return undefined;
  const list = catalog.lists.find((candidate) => candidate.key === canonicalSource[provider]);
  if (!list || !Array.isArray(list.problems) || !Array.isArray(list.items)) return undefined;
  const pageLocator = locator(provider, pageUrl, problemIdHint);
  const problem = list.problems.find((candidate) => (
    candidate.provider === provider
      && (pageLocator.problemId ? candidate.problemId === pageLocator.problemId : candidate.slug === pageLocator.slug)
  ));
  if (!problem) return undefined;
  const item = list.items.find((candidate) => candidate.problemKey === problem.problemKey);
  if (!item) return undefined;
  return { sourceKey: list.key, submissionKey: item.submissionKey, problem };
}

export function isProblemCatalog(value: unknown): value is ProblemCatalog {
  if (!value || typeof value !== "object" || !Array.isArray((value as ProblemCatalog).lists)) return false;
  return (["leetcode", "programmers", "swea"] as const).every((key) => {
    const list = (value as ProblemCatalog).lists.find((candidate) => candidate?.key === key);
    return Boolean(list && Array.isArray(list.problems) && Array.isArray(list.items));
  });
}

export function providerForUrl(pageUrl: string): Provider | undefined {
  const url = new URL(pageUrl);
  if (url.hostname === "leetcode.com" || url.hostname === "www.leetcode.com") return "leetcode";
  if (url.hostname === "school.programmers.co.kr") return "programmers";
  if (url.hostname === "swexpertacademy.com" || url.hostname === "www.swexpertacademy.com") return "swea";
  return undefined;
}
