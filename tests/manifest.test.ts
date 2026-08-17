import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../static/manifest.json", import.meta.url)), "utf8"));
const packageInfo = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

describe("Chrome extension manifest", () => {
  it("matches the package release version", () => {
    expect(manifest.version).toBe(packageInfo.version);
  });

  it("uses Manifest V3 with a module service worker and restricted permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: "background/service-worker.js", type: "module" });
    expect(manifest.permissions).toEqual(["alarms", "scripting", "storage"]);
    expect(manifest.permissions).not.toContain("tabs");
  });

  it("activates only on the three supported judge hosts", () => {
    const matches = manifest.content_scripts.flatMap((script: any) => script.matches).join("\n");
    expect(matches).toContain("leetcode.com/problems");
    expect(matches).toContain("school.programmers.co.kr");
    expect(matches).toContain("swexpertacademy.com");
  });

  it("installs the SWEA submission response hook in the main world before page scripts run", () => {
    expect(manifest.content_scripts[0]).toMatchObject({
      js: ["content/swea-page-hook.js"],
      run_at: "document_start",
      world: "MAIN",
      all_frames: true,
      match_about_blank: true,
    });
    expect(manifest.content_scripts[1]).toMatchObject({ all_frames: true, match_about_blank: true });
    expect(manifest.content_scripts[0].matches).toContain("https://swexpertacademy.com/*");
  });
});
