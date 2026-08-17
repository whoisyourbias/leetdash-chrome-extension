import { describe, expect, it } from "vitest";

import { isSolutionFilename, languageExtension } from "../src/shared/languages";

describe("submission languages", () => {
  it.each([
    ["C++17", "cpp"],
    ["Java", "java"],
    ["Python3", "py"],
    ["JavaScript", "js"],
    ["Kotlin 1.9", "kt"],
    ["text/x-java", "java"],
  ])("maps %s to %s", (language, extension) => {
    expect(languageExtension(language)).toBe(extension);
  });

  it("blocks unsupported repository extensions", () => {
    expect(languageExtension("Bash")).toBeUndefined();
    expect(isSolutionFilename("Solution.java")).toBe(true);
    expect(isSolutionFilename("solution.sh")).toBe(false);
  });
});
