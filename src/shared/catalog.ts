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

function dynamicSweaTitle(problemId: string, value: string | undefined): string {
  const normalized = (value ?? "")
    .replace(new RegExp(`^\\s*${problemId}\\s*\\.\\s*`), "")
    .replace(/\s*[|\-]\s*SW Expert Academy\s*$/i, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  return normalized && normalized.length <= 200 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : `SWEA ${problemId}`;
}

function dynamicSweaDifficulty(value: string | undefined): string {
  const normalized = value?.trim();
  return /^(?:D[1-8]|Attack)$/.test(normalized ?? "") ? normalized! : "Unknown";
}

function dynamicSweaSourceUrl(pageUrl: string, problemId: string): string {
  try {
    const parsed = new URL(pageUrl);
    if (
      parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && ["swexpertacademy.com", "www.swexpertacademy.com"].includes(parsed.hostname)
    ) {
      const normalized = new URL(`${parsed.origin}${parsed.pathname}`);
      for (const key of ["problemId", "problemTitle", "contestProbId"]) {
        const value = parsed.searchParams.get(key);
        if (value) normalized.searchParams.set(key, value);
      }
      return normalized.href;
    }
  } catch {
    // Fall through to a stable numeric SWEA URL.
  }
  return `https://swexpertacademy.com/main/code/problem/problemDetail.do?problemId=${problemId}`;
}

export type ResolvedCatalogProblem = {
  sourceKey: string;
  submissionKey: string;
  problem: CatalogProblem;
  origin: "catalog" | "page";
};

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
  override?: { provider: Provider; problemId: string },
  problemTitleHint?: string,
  problemDifficultyHint?: string,
  problemSourceUrlHint?: string,
): ResolvedCatalogProblem | undefined {
  if (!Array.isArray(catalog?.lists)) return undefined;
  const effectiveProvider = override?.provider ?? provider;
  const list = catalog.lists.find((candidate) => candidate.key === canonicalSource[effectiveProvider]);
  if (!list || !Array.isArray(list.problems) || !Array.isArray(list.items)) return undefined;
  const overrideProblemId = override ? numericProblemId(override.problemId) : undefined;
  if (override && overrideProblemId !== override.problemId) return undefined;
  const pageLocator = overrideProblemId ? { problemId: overrideProblemId } : locator(effectiveProvider, pageUrl, problemIdHint);
  const problem = list.problems.find((candidate) => (
    candidate.provider === effectiveProvider
      && (pageLocator.problemId ? candidate.problemId === pageLocator.problemId : candidate.slug === pageLocator.slug)
  ));
  if (problem) {
    const item = list.items.find((candidate) => candidate.problemKey === problem.problemKey);
    if (!item) return undefined;
    return { sourceKey: list.key, submissionKey: item.submissionKey, problem, origin: "catalog" };
  }
  if (effectiveProvider !== "swea" || !pageLocator.problemId) return undefined;
  const problemId = pageLocator.problemId;
  return {
    sourceKey: "swea",
    submissionKey: problemId,
    problem: {
      provider: "swea",
      problemId,
      problemKey: `swea:${problemId}`,
      title: dynamicSweaTitle(problemId, problemTitleHint),
      difficulty: dynamicSweaDifficulty(problemDifficultyHint),
      sourceUrl: dynamicSweaSourceUrl(problemSourceUrlHint ?? pageUrl, problemId),
    },
    origin: "page",
  };
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
