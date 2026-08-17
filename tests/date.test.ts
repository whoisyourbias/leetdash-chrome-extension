import { describe, expect, it } from "vitest";

import { nextSeoulMidnight, toSeoulDate } from "../src/shared/date";

describe("KST daily pull request dates", () => {
  it("uses the Accepted instant in Asia/Seoul", () => {
    expect(toSeoulDate("2026-08-16T14:59:59.000Z")).toEqual({ date: "2026-08-16", compact: "260816" });
    expect(toSeoulDate("2026-08-16T15:00:00.000Z")).toEqual({ date: "2026-08-17", compact: "260817" });
  });

  it("schedules the exact next Seoul midnight", () => {
    expect(new Date(nextSeoulMidnight("2026-08-17T03:00:00.000Z")).toISOString())
      .toBe("2026-08-17T15:00:00.000Z");
  });
});
