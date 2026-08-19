import { describe, expect, it } from "vitest";
import { hasAcceptedResult } from "../src/content/result";

describe("submission result detection", () => {
  it("does not treat a correctness-only score as a Programmers pass", () => {
    expect(hasAcceptedResult("programmers", "정확성 : 100.0\n효율성 : 0.0\n일부 테스트 실패")).toBe(false);
  });

  it("accepts a Programmers result only when the total is perfect", () => {
    expect(hasAcceptedResult("programmers", "정확성 : 100.0\n효율성 : 100.0\n합계 : 100.0")).toBe(true);
  });

  it("rejects a result containing a failure even when an old pass remains visible", () => {
    expect(hasAcceptedResult("programmers", "이전 제출: 합계 : 100\n이번 제출: 테스트 실패")).toBe(false);
  });
});
