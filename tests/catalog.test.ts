import { describe, expect, it } from "vitest";

import { isProblemCatalog, providerForUrl, resolveCatalogProblem } from "../src/shared/catalog";
import type { ProblemCatalog } from "../src/shared/model";

const catalog: ProblemCatalog = {
  lists: [
    {
      key: "leetcode",
      problems: [{ provider: "leetcode", problemId: "1", problemKey: "leetcode:1", slug: "two-sum", title: "Two Sum", sourceUrl: "https://leetcode.com/problems/two-sum/" }],
      items: [{ problemKey: "leetcode:1", submissionKey: "1" }],
    },
    {
      key: "programmers",
      problems: [{ provider: "programmers", problemId: "120583", problemKey: "programmers:120583", title: "중복된 숫자 개수", sourceUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/120583" }],
      items: [{ problemKey: "programmers:120583", submissionKey: "120583" }],
    },
    {
      key: "swea",
      problems: [{ provider: "swea", problemId: "1204", problemKey: "swea:1204", title: "최빈수", sourceUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?problemId=1204" }],
      items: [{ problemKey: "swea:1204", submissionKey: "1204" }],
    },
  ],
};

describe("platform catalog resolution", () => {
  it("rejects stale GitHub Contents metadata cached as a catalog", () => {
    const staleMetadata = { name: "problem-catalog.json", content: "", encoding: "none" };
    expect(isProblemCatalog(staleMetadata)).toBe(false);
    expect(resolveCatalogProblem(staleMetadata as unknown as ProblemCatalog, "programmers", "https://school.programmers.co.kr/learn/courses/30/lessons/12946"))
      .toBeUndefined();
  });

  it.each([
    ["leetcode", "https://leetcode.com/problems/two-sum/description/", "leetcode", "1"],
    ["programmers", "https://school.programmers.co.kr/learn/courses/30/lessons/120583?language=java", "programmers", "120583"],
    ["swea", "https://swexpertacademy.com/main/code/problem/problemDetail.do?problemId=1204", "swea", "1204"],
  ] as const)("resolves %s pages to the canonical source", (provider, url, sourceKey, submissionKey) => {
    expect(resolveCatalogProblem(catalog, provider, url)).toMatchObject({ sourceKey, submissionKey });
    expect(providerForUrl(url)).toBe(provider);
  });

  it("resolves real SWEA contestProbId URLs using the visible problem number hint", () => {
    expect(resolveCatalogProblem(
      catalog,
      "swea",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=AV13zo1KAAACFAYh",
      "1204. 최빈수",
    )).toMatchObject({ sourceKey: "swea", submissionKey: "1204" });
  });

  it("uses a validated manual provider and problem number instead of the detected URL", () => {
    expect(resolveCatalogProblem(
      catalog,
      "leetcode",
      "https://leetcode.com/problems/two-sum/description/",
      undefined,
      { provider: "swea", problemId: "1204" },
    )).toMatchObject({
      sourceKey: "swea",
      submissionKey: "1204",
      problem: { provider: "swea", problemId: "1204" },
    });
  });

  it("rejects a non-exact manual problem number", () => {
    expect(resolveCatalogProblem(
      catalog,
      "swea",
      "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
      "1204",
      { provider: "swea", problemId: "1204. 최빈수" },
    )).toBeUndefined();
  });

  it("fails closed for pages outside the checked-in catalog", () => {
    expect(resolveCatalogProblem(catalog, "leetcode", "https://leetcode.com/problems/not-catalogued/"))
      .toBeUndefined();
  });
});
