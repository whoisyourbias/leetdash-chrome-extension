import { describe, expect, it } from "vitest";

import { problemContextKey, visibleProblemId } from "../src/shared/problem-context";

describe("problem screen identity", () => {
  it.each([
    ["leetcode", "https://leetcode.com/problems/two-sum/description/", undefined, "leetcode:slug:two-sum"],
    ["programmers", "https://school.programmers.co.kr/learn/courses/30/lessons/120583", undefined, "programmers:problem:120583"],
    ["swea", "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=AV13zo1KAAACFAYh", "1204. 최빈수", "swea:title:1204. 최빈수"],
    ["swea", "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", "2071. 평균값 구하기", "swea:title:2071. 평균값 구하기"],
  ] as const)("builds a stable %s context key", (provider, url, title, expected) => {
    expect(problemContextKey(provider, url, title)).toBe(expected);
  });

  it("does not treat a generic SWEA page title as a problem identity", () => {
    expect(problemContextKey(
      "swea",
      "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
      "SW Expert Academy",
    )).toBeUndefined();
  });

  it("falls back to the SWEA contest ID when the visible title is unavailable", () => {
    expect(problemContextKey(
      "swea",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=AV13zo1KAAACFAYh",
    )).toBe("swea:contest:AV13zo1KAAACFAYh");
  });

  it("extracts only a leading visible problem number", () => {
    expect(visibleProblemId("2071. 평균값 구하기")).toBe("2071");
    expect(visibleProblemId("평균값 2071")).toBeUndefined();
  });
});
