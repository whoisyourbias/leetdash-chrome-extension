import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const archive = path.join(extensionRoot, "artifacts", "leetdash-extension.zip");

afterAll(async () => {
  await rm(path.join(extensionRoot, "artifacts"), { recursive: true, force: true });
});

describe("release packaging", () => {
  test("creates a Chrome Web Store ZIP without external executables", async () => {
    const result = spawnSync(process.execPath, ["scripts/package.mjs"], {
      cwd: extensionRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    });

    expect(result.status, result.stderr).toBe(0);
    const contents = await readFile(archive);
    expect(contents.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(contents.includes(Buffer.from("manifest.json"))).toBe(true);
  });
});
